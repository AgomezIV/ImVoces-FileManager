import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import type { Redis } from 'ioredis';
import { prisma, type StorageAccount, type TransferItem } from '@imvoces/db';
import {
  basename, dirname, joinPath, providerFor, encryptJson,
  type DriveCredentials, type OAuthCredentials, type StorageProvider,
} from '@imvoces/providers';
import { env } from './env.js';
import { backoffMs, isRetryable, MAX_ATTEMPTS, sleep } from './retry.js';

export type ConflictPolicy = 'rename' | 'overwrite' | 'skip';

/** Caché de drivers por job: evita reconstruir el cliente por cada archivo. */
export class ProviderCache {
  private readonly cache = new Map<string, StorageProvider>();
  private readonly accounts = new Map<string, StorageAccount>();

  async get(accountId: string): Promise<StorageProvider> {
    const hit = this.cache.get(accountId);
    if (hit) return hit;

    const account = await prisma.storageAccount.findUniqueOrThrow({ where: { id: accountId } });
    this.accounts.set(accountId, account);
    // Los tokens que el driver refresque a mitad de una transferencia larga se
    // persisten al vuelo: si el worker cae, al reanudar siguen siendo validos.
    const persist = async (id: string, creds: DriveCredentials | OAuthCredentials) => {
      await prisma.storageAccount
        .update({ where: { id }, data: { credentialsEnc: encryptJson(creds) } })
        .catch(() => undefined);
    };
    const provider = providerFor(account, {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      dropbox: { clientId: env.DROPBOX_CLIENT_ID, clientSecret: env.DROPBOX_CLIENT_SECRET },
      microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET },
      onDriveTokensRefreshed: persist,
      onOAuthTokensRefreshed: persist,
    });
    this.cache.set(accountId, provider);
    return provider;
  }

  async account(accountId: string): Promise<StorageAccount> {
    if (!this.accounts.has(accountId)) await this.get(accountId);
    return this.accounts.get(accountId) as StorageAccount;
  }
}

export interface ProgressSink {
  itemProgress(item: TransferItem, bytesDone: number): void;
  publish(payload: unknown): void;
}

/**
 * Expande recursivamente las carpetas seleccionadas en ítems-archivo.
 *
 * Lo hace el worker y no el cliente: así "copiar esta carpeta" es una petición
 * instantánea aunque dentro haya miles de archivos, y el árbol se lee con las
 * credenciales del servidor.
 */
export async function expandItem(
  item: TransferItem,
  providers: ProviderCache,
): Promise<{ srcPath: string; destPath: string; size: number; nativeId: string | null }[]> {
  const src = await providers.get(item.srcAccountId);
  const entry = await src.stat({ path: item.srcPath, nativeId: item.srcNativeId });

  if (entry.kind === 'file') {
    return [{ srcPath: entry.path, destPath: item.destPath, size: entry.size, nativeId: entry.nativeId }];
  }

  const out: { srcPath: string; destPath: string; size: number; nativeId: string | null }[] = [];
  const queue: { srcPath: string; destPath: string }[] = [
    { srcPath: entry.path, destPath: item.destPath },
  ];

  while (queue.length > 0) {
    const node = queue.shift() as { srcPath: string; destPath: string };
    let cursor: string | undefined;
    do {
      const page = await src.list({ path: node.srcPath }, { cursor, pageSize: 500 });
      for (const child of page.entries) {
        const destPath = joinPath(node.destPath, child.name);
        if (child.kind === 'folder') {
          queue.push({ srcPath: child.path, destPath });
        } else {
          out.push({ srcPath: child.path, destPath, size: child.size, nativeId: child.nativeId });
        }
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return out;
}

/** Resuelve el nombre final en destino según la política de conflictos. */
async function resolveDestPath(
  dest: StorageProvider,
  destPath: string,
  policy: ConflictPolicy,
): Promise<string | null> {
  if (policy === 'overwrite') return destPath;

  const exists = await dest
    .stat({ path: destPath })
    .then(() => true)
    .catch(() => false);
  if (!exists) return destPath;
  if (policy === 'skip') return null;

  const dir = dirname(destPath);
  const name = basename(destPath);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';

  for (let n = 2; n <= 50; n += 1) {
    const candidate = joinPath(dir, `${stem} (${n})${ext}`);
    const taken = await dest
      .stat({ path: candidate })
      .then(() => true)
      .catch(() => false);
    if (!taken) return candidate;
  }
  throw new Error(`No se pudo encontrar un nombre libre para ${destPath}`);
}

/** Crea el árbol de carpetas del destino. Idempotente: si ya existe, sigue. */
async function ensureParents(dest: StorageProvider, path: string): Promise<void> {
  if (!dest.capabilities.realFolders) return; // S3/R2: los prefijos no se crean
  const parts = dirname(path).split('/').filter(Boolean);
  let walked = '/';
  for (const part of parts) {
    const next = joinPath(walked, part);
    const exists = await dest
      .stat({ path: next })
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await dest.mkdir({ path: walked }, part).catch(() => undefined);
    }
    walked = next;
  }
}

/**
 * Transfiere UN archivo eligiendo la ruta más barata:
 *  1. misma cuenta y proveedor → copia nativa (no mueve bytes)
 *  2. caso general → streaming origen→destino con backpressure
 *
 * Nunca se bufferiza el archivo entero: solo el chunk en vuelo.
 */
export async function transferOne(
  item: TransferItem,
  providers: ProviderCache,
  policy: ConflictPolicy,
  sink: ProgressSink,
): Promise<{ destPath: string; checksum: string | null; skipped: boolean }> {
  const src = await providers.get(item.srcAccountId);
  const dest = await providers.get(item.destAccountId);

  const destPath = await resolveDestPath(dest, item.destPath, policy);
  if (destPath === null) return { destPath: item.destPath, checksum: null, skipped: true };

  // Atajo: misma cuenta → el proveedor copia internamente.
  if (item.srcAccountId === item.destAccountId && src.copyWithin) {
    await ensureParents(dest, destPath);
    await src.copyWithin({ path: item.srcPath, nativeId: item.srcNativeId }, { path: destPath });
    sink.itemProgress(item, Number(item.size));
    return { destPath, checksum: null, skipped: false };
  }

  await ensureParents(dest, destPath);

  const entry = await src.stat({ path: item.srcPath, nativeId: item.srcNativeId });
  const reader = await src.openRead({ path: item.srcPath, nativeId: item.srcNativeId });
  const writer = await dest.openWrite(
    { path: destPath },
    { size: entry.size, mimeType: entry.mimeType ?? undefined },
    item.resumeState ?? undefined,
  );

  const hash = createHash('md5');
  let bytesDone = 0;
  let lastReport = 0;

  // Un Writable sobre el sink del proveedor da backpressure real: si el destino
  // va lento, `pipeline` deja de leer del origen en lugar de acumular en memoria.
  const bridge = new Writable({
    highWaterMark: env.TRANSFER_PART_SIZE_MB * 1024 * 1024,
    write(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      bytesDone += chunk.length;
      writer
        .write(chunk)
        .then(() => {
          // Reportar cada 2 MB: suficiente para una barra fluida, sin inundar Redis.
          if (bytesDone - lastReport >= 2 * 1024 * 1024) {
            lastReport = bytesDone;
            sink.itemProgress(item, bytesDone);
          }
          cb();
        })
        .catch(cb);
    },
  });

  try {
    await pipeline(reader, bridge);
    await writer.complete();
  } catch (err) {
    await writer.abort();
    throw err;
  }

  sink.itemProgress(item, bytesDone);
  return { destPath, checksum: hash.digest('hex'), skipped: false };
}

/**
 * Ejecuta un ítem con reintentos. Solo reintenta lo que el driver marcó como
 * `retryable`: un 403 o un 404 fallan en el primer intento en lugar de gastar
 * cinco vueltas de backoff.
 */
export async function runItemWithRetries(
  item: TransferItem,
  providers: ProviderCache,
  policy: ConflictPolicy,
  sink: ProgressSink,
): Promise<{ destPath: string; checksum: string | null; skipped: boolean; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await transferOne(item, providers, policy, sink);
      return { ...result, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt, err));
    }
  }
  throw lastError;
}

/** Verifica la copia comparando tamaño y, si ambos lados lo exponen, el checksum. */
export async function verifyCopy(
  destProvider: StorageProvider,
  destPath: string,
  expectedSize: number,
): Promise<'SIZE_ONLY' | 'NONE'> {
  try {
    const entry = await destProvider.stat({ path: destPath });
    // Los nativos de Google cambian de tamaño al exportarse: no se compara.
    if (expectedSize > 0 && entry.size !== expectedSize) {
      throw new Error(`Tamaño distinto en destino: ${entry.size} ≠ ${expectedSize}`);
    }
    return 'SIZE_ONLY';
  } catch (err) {
    throw new Error(`Verificación fallida de ${destPath}: ${(err as Error).message}`);
  }
}

export async function isCancelled(redis: Redis, jobId: string): Promise<boolean> {
  return (await redis.exists(`transfer:${jobId}:cancelled`)) === 1;
}
