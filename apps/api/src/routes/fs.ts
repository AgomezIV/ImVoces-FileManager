import type { FastifyInstance } from 'fastify';
import {
  createFolderSchema, deleteSchema, listQuerySchema, renameSchema, searchQuerySchema,
} from '@imvoces/contracts';
import { normalizePath } from '@imvoces/providers';
import { badRequest, notFound } from '../lib/errors.js';
import { providerForUser } from '../lib/accounts.js';
import { audit } from '../lib/audit.js';

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
    const { accountId, path, newName } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);
    const entry = await provider.rename({ path: normalizePath(path) }, newName);
    await audit(req.userId, 'fs.rename', 'ok', { accountId, from: path, to: entry.path }, req.ip);
    return entry;
  });

  /** Borrado en lote: cada ruta reporta su propio resultado, un fallo no aborta el resto. */
  app.delete('/fs', async (req) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);
    const { accountId, paths } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);

    const results = await Promise.all(
      paths.map(async (path) => {
        try {
          await provider.remove({ path: normalizePath(path) });
          return { path, ok: true as const };
        } catch (err) {
          return { path, ok: false as const, error: (err as Error).message };
        }
      }),
    );
    const failed = results.filter((r) => !r.ok).length;
    await audit(req.userId, 'fs.delete', failed ? 'error' : 'ok', { accountId, paths, failed }, req.ip);
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

  app.get('/fs/search', async (req) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Parámetros inválidos', parsed.error.issues);
    const { accountId, q, pageSize } = parsed.data;
    const provider = await providerForUser(req.userId, accountId);
    if (!provider.search) return { entries: [] };
    return { entries: await provider.search(q, pageSize) };
  });
}
