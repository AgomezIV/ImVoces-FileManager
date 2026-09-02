import type { FastifyInstance } from 'fastify';
import {
  createFolderSchema, deleteSchema, listQuerySchema, renameSchema, searchQuerySchema,
} from '@imvoces/contracts';
import { normalizePath } from '@imvoces/providers';
import { badRequest, notFound } from '../lib/errors.js';
import { providerForUser } from '../lib/accounts.js';
import { audit } from '../lib/audit.js';

/** Traduce la cabecera `Range` del navegador al rango que entiende el driver. */
function parseRange(header: string | undefined, size: number): { start: number; end?: number } | null {
  if (!header?.startsWith('bytes=')) return null;
  const [rawStart, rawEnd] = header.slice(6).split('-');
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0 || (size > 0 && start >= size)) return null;
  const end = rawEnd ? Number(rawEnd) : undefined;
  return { start, end: Number.isFinite(end) ? end : undefined };
}

/** Endpoints del explorador. Todos operan sobre rutas normalizadas y cuentas propias. */
export async function fsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireUser);

  app.get('/fs/list', async (req) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Parámetros inválidos', parsed.error.issues);
    const { accountId, path, cursor, pageSize } = parsed.data;

    const provider = await providerForUser(req.userId, accountId);
    const page = await provider.list({ path: normalizePath(path) }, { cursor, pageSize });
    return { entries: page.entries, nextCursor: page.nextCursor, path: normalizePath(path) };
  });

  app.get('/fs/stat', async (req) => {
    const { accountId, path } = req.query as { accountId?: string; path?: string };
    if (!accountId || !path) throw badRequest('Faltan accountId y path');
    const provider = await providerForUser(req.userId, accountId);
    return provider.stat({ path: normalizePath(path) });
  });

  app.post('/fs/folder', async (req) => {
    const parsed = createFolderSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);
    const { accountId, parentPath, name } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);
    const entry = await provider.mkdir({ path: normalizePath(parentPath) }, name);
    await audit(req.userId, 'fs.mkdir', 'ok', { accountId, path: entry.path }, req.ip);
    return entry;
  });

  app.patch('/fs/rename', async (req) => {
    const parsed = renameSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);
    const { accountId, path, nativeId, newName } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);
    const entry = await provider.rename({ path: normalizePath(path), nativeId }, newName);
    await audit(req.userId, 'fs.rename', 'ok', { accountId, from: path, to: entry.path }, req.ip);
    return entry;
  });

  /** Borrado en lote: cada ruta reporta su propio resultado, un fallo no aborta el resto. */
  app.delete('/fs', async (req) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);
    const { accountId, items } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);

    const results = await Promise.all(
      items.map(async ({ path, nativeId }) => {
        try {
          await provider.remove({ path: normalizePath(path), nativeId });
          return { path, ok: true as const };
        } catch (err) {
          return { path, ok: false as const, error: (err as Error).message };
        }
      }),
    );
    const failed = results.filter((r) => !r.ok).length;
    await audit(
      req.userId, 'fs.delete', failed ? 'error' : 'ok',
      { accountId, paths: items.map((i) => i.path), failed }, req.ip,
    );
    return { results, failed };
  });

  /** URL para previsualizar o descargar directamente, sin pasar por nuestro servidor. */
  app.get('/fs/download-url', async (req) => {
    const { accountId, path } = req.query as { accountId?: string; path?: string };
    if (!accountId || !path) throw badRequest('Faltan accountId y path');
    const provider = await providerForUser(req.userId, accountId);
    if (!provider.signedUrl) throw notFound('Este proveedor no emite URLs de descarga');
    return { url: await provider.signedUrl({ path: normalizePath(path) }, 900) };
  });

  /**
   * Sirve los bytes del archivo a través de la API.
   *
   * Es lo que permite ver miniaturas y previsualizaciones sin exponer las
   * credenciales del proveedor: el navegador pide a nuestra API y esta lee del
   * proveedor con los tokens que solo el servidor conoce. Respeta `Range`, así
   * que un vídeo se puede saltar sin descargarlo entero.
   */
  app.get('/fs/content', async (req, reply) => {
    const { accountId, path, nativeId, download } = req.query as {
      accountId?: string;
      path?: string;
      nativeId?: string;
      download?: string;
    };
    if (!accountId || !path) throw badRequest('Faltan accountId y path');

    const provider = await providerForUser(req.userId, accountId);
    const clean = normalizePath(path);
    const entry = await provider.stat({ path: clean, nativeId });
    if (entry.kind === 'folder') throw badRequest('No se puede leer una carpeta');

    const range = parseRange(req.headers.range, entry.size);
    const stream = await provider.openRead({ path: clean, nativeId }, range ?? undefined);

    const name = clean.slice(clean.lastIndexOf('/') + 1);
    reply
      .header('Content-Type', entry.mimeType ?? 'application/octet-stream')
      .header('Accept-Ranges', 'bytes')
      // El token puede venir por query en este endpoint: sin referrer no se filtra.
      .header('Referrer-Policy', 'no-referrer')
      .header('Cache-Control', 'private, max-age=300')
      .header(
        'Content-Disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`,
      );

    if (range) {
      const end = range.end ?? entry.size - 1;
      reply
        .status(206)
        .header('Content-Range', `bytes ${range.start}-${end}/${entry.size}`)
        .header('Content-Length', String(end - range.start + 1));
    } else if (entry.size > 0) {
      reply.header('Content-Length', String(entry.size));
    }

    return reply.send(stream);
  });

  app.get('/fs/search', async (req) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Parámetros inválidos', parsed.error.issues);
    const { accountId, q, pageSize } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);
    if (!provider.search) return { entries: [] };
    return { entries: await provider.search(q, pageSize) };
  });
}
