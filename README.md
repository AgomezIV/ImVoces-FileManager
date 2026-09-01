# ImVoces FileManager

Gestor de archivos **multi-nube**: conecta Google Drive, Cloudflare R2 y más, ve todo en una sola
interfaz y **copia o mueve entre plataformas con un clic**.

Las transferencias corren **en el servidor**, en streaming: no descargan a tu dispositivo, no gastan
tu conexión y no se detienen si cierras la app.

Dos clientes sobre un mismo backend:

- **Web** — Next.js, explorador de doble panel con arrastrar y soltar.
- **Android** — Flutter, distribuible como `.apk`.

## Arquitectura

```
Web (Next.js) ─┐
               ├─ REST + SSE ─→ API (Fastify) ─→ PostgreSQL (74.208.99.84)
Android (Flutter) ─┘                │
                                    ├─→ Redis (cola BullMQ + progreso)
                                    ↓
                            Transfer Worker ──→ Google Drive · Cloudflare R2 · S3…
                              (stream origen → destino)
```

Los tokens de los proveedores **nunca salen del backend**: se cifran con AES-256-GCM y los clientes
solo hablan con nuestra API. Eso es lo que permite transferencias server-side reales y evita meter
credenciales de terceros en un `.apk`, donde serían extraíbles.

## Estructura

| Ruta | Qué es |
|---|---|
| `apps/api` | API Fastify: auth, cuentas, explorador, transferencias, SSE |
| `apps/worker` | Motor de transferencias (BullMQ): expansión, streaming, reintentos |
| `apps/web` | Cliente web Next.js 15 |
| `apps/mobile` | App Flutter → `.apk` |
| `packages/contracts` | Esquemas Zod: fuente de verdad de la API |
| `packages/providers` | Interfaz `StorageProvider` + drivers por nube |
| `packages/db` | Esquema Prisma y cliente de PostgreSQL |
| `docs/PLAN.md` | Plan completo: fases, decisiones y riesgos |

## Puesta en marcha

Requisitos: Node 22+, pnpm 10, Docker (para Redis), Flutter 3.24+ (solo para el móvil).

```bash
cp .env.example .env          # rellena DATABASE_URL, secretos y credenciales de Google
docker compose -f infra/docker-compose.yml up -d redis

pnpm install
pnpm --filter @imvoces/db exec prisma migrate deploy   # crea el esquema en PostgreSQL
pnpm --filter @imvoces/contracts build
pnpm --filter @imvoces/providers build

pnpm --filter @imvoces/api dev      # :4000
pnpm --filter @imvoces/worker dev
pnpm --filter @imvoces/web dev      # :3000
```

Genera los dos secretos con `openssl`:

```bash
openssl rand -base64 48   # → JWT_SECRET
openssl rand -base64 32   # → CREDENTIALS_KEY (debe decodificar a 32 bytes exactos)
```

### App Android

```bash
cd apps/mobile
flutter pub get
flutter run                                   # emulador: la API se ve en 10.0.2.2:4000
flutter build apk --release --split-per-abi \
  --dart-define=API_BASE_URL=https://api.tu-dominio.com \
  --dart-define=GOOGLE_SERVER_CLIENT_ID=<client_id_web>
```

El `.apk` sale en `build/app/outputs/flutter-apk/`. El workflow de CI lo compila y lo sube como
artifact en cada push.

## Google Cloud

En **APIs & Services → Credentials** hacen falta dos client IDs del mismo proyecto:

- **Web**: para el login de la web y como `serverClientId` de Android (es el que emite el `idToken`
  que valida la API). Añade `.../accounts/callback` a los URIs de redirección autorizados.
- **Android**: con el package `com.imvoces.filemanager` y la huella SHA-1 de tu keystore.

Habilita la **Google Drive API**. Los scopes empiezan en `drive.file`; los scopes amplios de Drive
son *restricted* y exigen revisión de seguridad de Google antes de publicar.

## Añadir un proveedor nuevo

1. Implementa `StorageProvider` en `packages/providers/src/drivers/<nombre>.ts`.
2. Añade el `case` en `packages/providers/src/registry.ts` y el valor al enum `ProviderId` del
   esquema Prisma.

Ni la API ni los clientes cambian.
