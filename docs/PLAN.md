# Plan: ImVoces-FileManager — gestor de archivos multi-nube (Web + App Android .apk)

## Contexto

Hoy mover archivos entre nubes (Google Drive, Cloudflare R2, S3, Dropbox…) obliga a descargar
localmente y volver a subir: lento, consume disco y ancho de banda del usuario, y no hay una vista
unificada. El objetivo es un gestor de archivos **multi-nube** donde el usuario conecta varias
cuentas, las ve todas en una interfaz única, y **copia/mueve entre plataformas con un clic** — la
transferencia ocurre server-side, en streaming, sin pasar por el dispositivo.

Se entregan **dos clientes**: una **web** (Next.js/React) y una **app Android nativa** (Flutter,
distribuible como `.apk`), sobre un **backend Node + PostgreSQL** compartido. Autenticación con
**Google Login**. Prioridad de producto: *dinamismo y pocos pasos* — la acción principal (copiar de
A a B) debe resolverse en un gesto.

El repo destino es **`AgomezIV/ImVoces-FileManager`** (clonado en `/home/user/imvoces-filemanager`):
hoy solo contiene `README.md`, `LICENSE` (Apache-2.0) y un `.gitignore` de Node/JS — es greenfield, y
ese `.gitignore` ya cubre `node_modules/`, `.env*`, `.next`, `.pnpm-store` (habrá que añadirle las
rutas de Flutter/Android: `apps/mobile/build/`, `.dart_tool/`, `*.jks`, `key.properties`).
**Este entregable es únicamente el documento de plan**; la implementación viene en una sesión posterior.

---

## 1. Arquitectura

```
┌────────────┐        ┌────────────┐
│  Web       │        │  Flutter   │
│  Next.js   │        │  Android   │
└─────┬──────┘        └─────┬──────┘
      │  REST + SSE (OpenAPI)     │
      └────────────┬─────────────┘
                   ▼
        ┌──────────────────────┐      ┌───────────┐
        │  API (Fastify/TS)    │◄────►│ PostgreSQL│
        │  auth · providers    │      └───────────┘
        │  explorer · jobs     │      ┌───────────┐
        └──────────┬───────────┘◄────►│   Redis   │ (cola + progreso)
                   ▼                  └───────────┘
        ┌──────────────────────┐
        │  Transfer Worker     │  stream: origen → destino
        └──────┬───────┬───────┘
               ▼       ▼
         Google Drive  Cloudflare R2 / S3 / …
```

**Decisión clave:** los tokens de los proveedores **nunca** salen del backend. Los clientes solo
hablan con nuestra API. Esto: (a) permite transferencias server-side reales, (b) evita guardar
credenciales de terceros en un `.apk` (donde son extraíbles), (c) hace que web y móvil compartan
exactamente la misma lógica de negocio.

**Monorepo pnpm** (workspaces) para JS/TS; Flutter vive dentro del repo pero fuera del workspace pnpm.

```
/apps
  /api        Fastify + TypeScript (REST, OAuth, SSE)
  /worker     Consumidor BullMQ del motor de transferencias
  /web        Next.js 15 (App Router) + React + TanStack Query
  /mobile     Flutter (Dart) → .apk
/packages
  /contracts  Esquemas Zod + OpenAPI (fuente de verdad de la API)
  /providers  Abstracción StorageProvider + drivers (drive, r2, s3…)
  /db         Prisma schema, migraciones, cliente
  /ui         Tokens de diseño + componentes web compartidos
/infra        docker-compose (postgres, redis), Dockerfiles
/.github/workflows
```

`packages/contracts` genera el cliente TS (web) y, vía `openapi-generator`/`dio`, el cliente Dart
(móvil) — un solo contrato, dos clientes tipados, sin drift entre plataformas.

---

## 2. Abstracción de proveedores (el corazón del producto)

`packages/providers` define una interfaz única que todo driver implementa:

```ts
interface StorageProvider {
  id: ProviderId                      // 'gdrive' | 'r2' | 's3' | 'dropbox' | ...
  capabilities: { serverSideCopy, multipart, resumable, folders, search, quota }

  list(path: RemoteRef, opts: { cursor?, pageSize }): Promise<Page<RemoteEntry>>
  stat(ref: RemoteRef): Promise<RemoteEntry>
  mkdir(parent: RemoteRef, name: string): Promise<RemoteEntry>
  delete(ref: RemoteRef): Promise<void>
  rename(ref: RemoteRef, name: string): Promise<RemoteEntry>

  openRead(ref: RemoteRef, range?: ByteRange): Promise<ReadableStream>
  openWrite(dest: RemoteRef, meta: { size?, mimeType }): Promise<WritableSink>

  copyWithin?(src, dest): Promise<RemoteEntry>   // atajo intra-proveedor
  signedUrl?(ref, ttl): Promise<string>          // preview/descarga directa
}
```

**Drivers en fase 1:** Google Drive (API v3, descarga resumible + upload resumible) y
Cloudflare R2 (`@aws-sdk/client-s3`, multipart). **Fase 2:** S3 genérico, Backblaze B2, Dropbox,
OneDrive, WebDAV. Añadir un proveedor = un archivo nuevo en `packages/providers/src/drivers/` y
una entrada en el registry; ni la API ni los clientes cambian.

**Normalización.** Drive es un grafo de IDs con MIME-types propios (Google Docs no tienen bytes
descargables directos → exportar a `.docx`/`.pdf`), R2 es un espacio de claves plano donde las
"carpetas" son prefijos. `RemoteRef = { accountId, path: string, nativeId?: string }` y cada driver
traduce; la UI solo ve rutas y entradas homogéneas.

---

## 3. Motor de transferencias

Un "copiar de A a B" crea un **`TransferJob`** con N **`TransferItem`** (expansión recursiva de
carpetas hecha por el worker, no por el cliente).

Por ítem, el worker elige la ruta más barata:
1. **Mismo proveedor y misma cuenta** → `copyWithin` (copia nativa, coste ~0).
2. **R2 ↔ S3 compatible** → intento de `CopyObject` cross-bucket si hay credenciales en ambos.
3. **Caso general** → **streaming en tubería**: `openRead(src).pipe(openWrite(dest))` con
   backpressure. Sin buffer completo en disco; solo chunks (5–16 MB) para el multipart.

Robustez:
- **Reintentos** con backoff exponencial + jitter; los errores se clasifican en
  `retryable` (429, 5xx, red) vs `fatal` (403, 404, cuota llena) y solo los primeros reintentan.
- **Reanudación**: se persiste el `uploadId` y las partes confirmadas de cada multipart, y el offset
  del origen, para continuar sin reempezar tras una caída del worker.
- **Idempotencia**: cada ítem tiene una clave `(jobId, srcRef, destRef)` única; reencolar no duplica.
- **Concurrencia** limitada por cuenta (respeta los rate limits de Drive: 429 + `Retry-After`).
- **Verificación**: comparación de tamaño siempre; checksum (MD5/SHA-256) cuando ambos lados lo
  exponen, marcando el ítem como `verified` o `size-only`.
- **Mover** = copiar + verificar + borrar origen, y el borrado solo tras verificación exitosa.

**Progreso en vivo:** el worker publica a Redis pub/sub; la API expone `GET /jobs/:id/events` (SSE).
Web usa `EventSource`; Flutter usa el mismo SSE sobre `dio`, con fallback a polling cada 3 s si la
conexión se corta (y en Android, notificación de progreso cuando la app está en segundo plano).

---

## 4. Autenticación y seguridad

Dos niveles, deliberadamente separados:

- **Identidad de la app**: Google Sign-In (OIDC). Web con Authorization Code + PKCE; Flutter con
  `google_sign_in` → el `idToken` se canjea en `POST /auth/google` por sesión propia
  (access JWT corto + refresh token rotativo en cookie `HttpOnly` en web, en `flutter_secure_storage`
  en móvil). El backend **valida siempre** el `idToken` contra las claves de Google (issuer, aud, exp).
- **Conexión de cuentas de almacenamiento**: flujo OAuth aparte por cuenta (Drive), o credenciales
  de API (R2: account id + access key + secret). Se piden **scopes mínimos** (`drive.file` primero;
  `drive.readonly`/`drive` solo si el usuario necesita ver todo su Drive — y explicado en la UI).
  En móvil el consentimiento se abre con Custom Tabs / ASWebAuthenticationSession, nunca en WebView.

Medidas concretas:
- Tokens y secretos de proveedor **cifrados en reposo** (AES-256-GCM con clave de entorno / KMS),
  nunca devueltos por la API — el cliente solo ve `accountId`, etiqueta y avatar.
- Verificación de propiedad en cada endpoint: toda `RemoteRef` se resuelve contra
  `accounts.userId = session.userId` antes de tocar el proveedor.
- Rate limiting por usuario y cuota de transferencia; validación de entrada con Zod en todo endpoint.
- Cabeceras estrictas (CSP, HSTS), CORS restringido a los orígenes propios.
- Android: `network_security_config` sin cleartext, sin secretos en el `.apk`, ProGuard/R8 activado.
- Auditoría: tabla `audit_log` con toda acción destructiva (delete, move) y el resultado.

---

## 5. Modelo de datos (Prisma / PostgreSQL)

| Tabla | Campos clave |
|---|---|
| `User` | `id`, `googleSub` (único), `email`, `name`, `avatarUrl`, `createdAt` |
| `Session` | `id`, `userId`, `refreshTokenHash`, `device`, `expiresAt`, `revokedAt` |
| `StorageAccount` | `id`, `userId`, `provider`, `label`, `externalId`, `credentialsEnc`, `scopes`, `status`, `quotaUsed/Total` |
| `TransferJob` | `id`, `userId`, `kind` (copy/move), `status`, `totalBytes`, `doneBytes`, `itemsTotal/Done/Failed`, `startedAt`, `finishedAt`, `error` |
| `TransferItem` | `id`, `jobId`, `srcAccountId`, `srcPath`, `destAccountId`, `destPath`, `size`, `status`, `attempts`, `resumeState` (jsonb), `checksum`, `error` |
| `AuditLog` | `id`, `userId`, `action`, `target` (jsonb), `result`, `ip`, `createdAt` |

Índices: `TransferItem(jobId, status)`, `StorageAccount(userId)`, `TransferJob(userId, createdAt desc)`.
Migraciones con `prisma migrate`; nada de SQL manual en runtime.

---

## 6. Superficie de API (REST + SSE)

```
POST   /auth/google            canjea idToken → sesión
POST   /auth/refresh           rotación de refresh token
POST   /auth/logout

GET    /accounts                       cuentas conectadas + estado/cuota
POST   /accounts/:provider/connect     inicia OAuth (devuelve authUrl + state)
GET    /accounts/callback              callback OAuth
POST   /accounts/r2                    alta por credenciales (R2/S3)
DELETE /accounts/:id

GET    /fs/list?accountId&path&cursor  listado paginado normalizado
GET    /fs/stat?accountId&path
POST   /fs/folder                      crear carpeta
PATCH  /fs/rename
DELETE /fs                             borrar
GET    /fs/download-url                URL firmada para preview/descarga
GET    /fs/search?accountId&q

POST   /transfers                      { kind, items:[{src,dest}] } → jobId
GET    /transfers?status                historial
GET    /transfers/:id
GET    /transfers/:id/events           SSE de progreso
POST   /transfers/:id/cancel
POST   /transfers/:id/retry            reintenta solo los ítems fallidos
```

Todo definido en `packages/contracts` (Zod → OpenAPI 3.1) y de ahí se generan ambos clientes.

---

## 7. Cliente Web (`apps/web`)

Next.js 15 (App Router) + TypeScript, TanStack Query para caché/optimistic updates, Tailwind +
componentes de `packages/ui`.

- **Explorador de doble panel** (origen | destino) con breadcrumbs, selección múltiple, vista
  lista/cuadrícula. Es la interfaz que hace literal el "un clic": seleccionar → botón central
  **Copiar →** / **← Copiar**.
- **Drag & drop** entre paneles, y también desde el escritorio para subir.
- **Selector de cuenta** por panel; conectar una cuenta nueva es una tarjeta más en el selector.
- **Bandeja de transferencias** flotante y persistente (como la de Drive): progreso por ítem,
  velocidad, ETA, cancelar, reintentar fallidos. Sobrevive a la navegación entre páginas.
- Virtualización de listas (`@tanstack/virtual`) para carpetas de miles de archivos.
- Atajos de teclado (`c` copiar, `m` mover, `del` borrar, `/` buscar) — pocos pasos también sin ratón.

## 8. Cliente Móvil (`apps/mobile`, Flutter → `.apk`)

Flutter 3.x, Riverpod (estado), go_router (navegación), dio + cliente generado del OpenAPI,
`google_sign_in`, `flutter_secure_storage`.

- **Un panel a la vez** (el doble panel no cabe en móvil): navegas el origen, seleccionas, pulsas
  **Enviar a…** y un bottom-sheet muestra tus cuentas y un mini-navegador para elegir destino.
  Dos toques desde la selección hasta la transferencia en marcha.
- Pestañas inferiores: **Archivos · Transferencias · Cuentas**.
- Progreso en segundo plano con notificación (`flutter_local_notifications`) alimentada por el SSE;
  como la transferencia corre en el servidor, cerrar la app **no** la cancela — diferencia clave
  frente a los gestores locales, y hay que comunicarla en la UI.
- Compartir hacia la app (`share_intent`) para subir desde otras apps; abrir/previsualizar vía URL firmada.
- **Build del `.apk`**: `flutter build apk --split-per-abi --release`, firmado con keystore
  (`key.properties` fuera del repo; en CI desde secrets). Se publica como artifact de GitHub Actions
  y como asset de release para instalación directa. `--split-per-abi` reduce el tamaño ~40%.

Web y móvil comparten tokens de diseño (colores, tipografía, espaciado, iconografía de proveedores)
definidos una vez en `packages/ui/tokens` y exportados a Dart para que ambas apps se vean como una.

---

## 9. Fases de entrega

| Fase | Alcance | Resultado verificable |
|---|---|---|
| **0. Cimientos** | Monorepo pnpm, docker-compose (Postgres+Redis), Prisma, CI de lint/test | `pnpm dev` levanta API + web |
| **1. Auth** | Google Sign-In web + móvil, sesiones, `/accounts` | Login desde ambos clientes |
| **2. Providers** | Interfaz + drivers Drive y R2, `/fs/*` | Listar y navegar ambas nubes |
| **3. Explorador web** | Doble panel, breadcrumbs, selección, borrar/renombrar/crear carpeta | Gestión completa desde web |
| **4. Motor de transferencias** | Cola, worker, streaming, reintentos, SSE, bandeja | Copiar Drive → R2 con progreso real |
| **5. App móvil** | Navegación, "Enviar a…", transferencias, notificaciones | `.apk` instalable y funcional |
| **6. Endurecer** | Reanudación, checksums, cuotas, auditoría, rate limits, observabilidad | Carpeta grande copiada sobreviviendo a un reinicio del worker |
| **7. Ampliar** | S3/B2/Dropbox/OneDrive, búsqueda global, sincronización programada | Nuevos drivers sin tocar clientes |

MVP demostrable = fases 0–5. Cada fase termina con su propia verificación, no se acumulan.

---

## 10. Verificación

**Automática**
- `packages/providers`: tests unitarios por driver contra un servidor S3 local (MinIO en Docker) y
  un mock HTTP de Drive; matriz de casos raros (Google Docs, nombres duplicados, rutas con `/`,
  archivos de 0 bytes, ficheros >5 GB simulados con streams sintéticos).
- API: tests de integración con Postgres efímero (Testcontainers) — auth, aislamiento entre usuarios
  (un usuario no puede referenciar la cuenta de otro), ciclo de vida de un job.
- Worker: test de reanudación — matar el proceso a mitad de un multipart y comprobar que reanuda y
  el checksum final coincide.
- Web: Playwright sobre el flujo login → conectar cuentas → copiar → ver progreso.
- Móvil: `flutter test` (unidad/widget) + un `integration_test` del flujo "Enviar a…".
- CI (GitHub Actions): lint + typecheck + tests en cada PR; job aparte que compila el `.apk` y lo
  sube como artifact.

**Manual (criterios de aceptación)**
1. Copiar una carpeta de ~500 archivos de Drive a R2: termina sin fallos, el conteo y los tamaños
   coinciden en destino.
2. Cortar la red a mitad de transferencia: el job pasa a reintentando y se completa al volver.
3. Cerrar la app móvil durante una transferencia: al reabrir, sigue en marcha y muestra el progreso real.
4. Un archivo grande (>2 GB) se transfiere sin que la memoria del worker suba de forma proporcional
   (confirma que hay streaming, no buffering).
5. Cronómetro sobre el objetivo de producto: desde archivo seleccionado hasta transferencia iniciada,
   **≤2 interacciones en web y ≤3 en móvil**.

---

## Riesgos y decisiones abiertas

- **Costes de egreso**: sacar datos de Drive/S3 tiene coste y el tráfico pasa por nuestro servidor.
  Mitigación: usar copia nativa siempre que se pueda, desplegar el worker cerca de los buckets, y
  mostrar el volumen transferido al usuario. R2 no cobra egreso, lo que lo hace buen destino por defecto.
- **Verificación de Google**: los scopes amplios de Drive (`drive`, `drive.readonly`) son *restricted*
  y requieren revisión de seguridad de Google (semanas, y posible auditoría de terceros). Por eso el
  plan arranca con `drive.file`: hay que decidir pronto si se asume ese proceso.
- **Escalado del worker**: un solo worker satura ancho de banda antes que CPU. Diseñar desde el
  principio para N réplicas coordinadas por la cola (ya contemplado con BullMQ + idempotencia).
- **Distribución del `.apk`**: fuera de Play Store implica "orígenes desconocidos" y sin
  actualizaciones automáticas. Conviene decidir si habrá también canal de Play Store (entonces se
  necesita `.aab` además del `.apk`).
