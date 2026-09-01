import type { FastifyInstance } from 'fastify';
import { createTransferSchema } from '@imvoces/contracts';
import { prisma, type TransferJob, type TransferItem } from '@imvoces/db';
import { normalizePath } from '@imvoces/providers';
import { badRequest, notFound } from '../lib/errors.js';
import { ownedAccount } from '../lib/accounts.js';
import { audit } from '../lib/audit.js';
import { cancelKey, jobChannel, redis, transferQueue } from '../lib/queue.js';

function toJobView(job: TransferJob & { items?: TransferItem[] }) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    totalBytes: Number(job.totalBytes),
    doneBytes: Number(job.doneBytes),
    itemsTotal: job.itemsTotal,
    itemsDone: job.itemsDone,
    itemsFailed: job.itemsFailed,
    error: job.error,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    items: job.items?.map((i) => ({
      id: i.id,
      srcAccountId: i.srcAccountId,
      srcPath: i.srcPath,
      destAccountId: i.destAccountId,
      destPath: i.destPath,
      size: Number(i.size),
      bytesDone: Number(i.bytesDone),
      status: i.status,
      attempts: i.attempts,
      error: i.error,
    })),
  };
}

export async function transferRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireUser);

  /**
   * El "un clic": se crea el job con la selección tal cual llegó.
   * La expansión recursiva de carpetas la hace el worker, no el cliente —
   * así la petición responde al instante aunque sean miles de archivos.
   */
  app.post('/transfers', async (req) => {
    const parsed = createTransferSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);
    const { kind, items, onConflict } = parsed.data;

    // Se validan TODAS las cuentas antes de crear nada: o el job entero es legítimo o no se crea.
    const accountIds = new Set(items.flatMap((i) => [i.src.accountId, i.dest.accountId]));
    await Promise.all([...accountIds].map((id) => ownedAccount(req.userId, id)));

    const job = await prisma.transferJob.create({
      data: {
        userId: req.userId,
        kind,
        status: 'QUEUED',
        itemsTotal: items.length,
        items: {
          create: items.map((i) => ({
            srcAccountId: i.src.accountId,
            srcPath: normalizePath(i.src.path),
            srcNativeId: i.src.nativeId ?? null,
            destAccountId: i.dest.accountId,
            destPath: normalizePath(i.dest.path),
          })),
        },
      },
      include: { items: true },
    });

    await transferQueue.add(
      'run',
      { jobId: job.id, userId: req.userId, onConflict },
      { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
    );
    await audit(req.userId, 'transfer.create', 'ok', { jobId: job.id, kind, count: items.length }, req.ip);
    return toJobView(job);
  });

  app.get('/transfers', async (req) => {
    const { status, limit } = req.query as { status?: string; limit?: string };
    const jobs = await prisma.transferJob.findMany({
      where: {
        userId: req.userId,
        ...(status ? { status: status as TransferJob['status'] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit ?? 50), 200),
    });
    return { jobs: jobs.map((j) => toJobView(j)) };
  });

  app.get('/transfers/:id', async (req) => {
    const { id } = req.params as { id: string };
    const job = await prisma.transferJob.findFirst({
      where: { id, userId: req.userId },
      include: { items: { orderBy: { createdAt: 'asc' }, take: 1000 } },
    });
    if (!job) throw notFound('Transferencia no encontrada');
    return toJobView(job);
  });

  /**
   * Progreso en vivo por SSE. El worker publica en Redis y aquí se reenvía.
   * Se manda un `ping` periódico para que proxies y móviles no corten la conexión.
   */
  app.get('/transfers/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.transferJob.findFirst({ where: { id, userId: req.userId } });
    if (!job) throw notFound('Transferencia no encontrada');

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (payload: unknown) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ type: 'job', job: toJobView(job) });

    const sub = redis.duplicate();
    await sub.subscribe(jobChannel(id));
    sub.on('message', (_channel: string, message: string) => reply.raw.write(`data: ${message}\n\n`));

    const ping = setInterval(() => send({ type: 'ping' }), 20_000);
    const cleanup = () => {
      clearInterval(ping);
      void sub.unsubscribe(jobChannel(id)).catch(() => undefined);
      void sub.quit().catch(() => undefined);
    };
    req.raw.on('close', cleanup);
    reply.raw.on('error', cleanup);

    // La respuesta la cierra el cliente: no se resuelve el handler.
    return reply;
  });

  /** La cancelación es cooperativa: el worker consulta la bandera entre ítems. */
  app.post('/transfers/:id/cancel', async (req) => {
    const { id } = req.params as { id: string };
    const job = await prisma.transferJob.findFirst({ where: { id, userId: req.userId } });
    if (!job) throw notFound('Transferencia no encontrada');

    await redis.set(cancelKey(id), '1', 'EX', 86_400);
    await prisma.transferJob.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await prisma.transferItem.updateMany({
      where: { jobId: id, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED' },
    });
    await audit(req.userId, 'transfer.cancel', 'ok', { jobId: id }, req.ip);
    return { ok: true };
  });

  /** Reintenta solo los ítems fallidos: no se rehace lo que ya está en destino. */
  app.post('/transfers/:id/retry', async (req) => {
    const { id } = req.params as { id: string };
    const job = await prisma.transferJob.findFirst({ where: { id, userId: req.userId } });
    if (!job) throw notFound('Transferencia no encontrada');

    const reset = await prisma.transferItem.updateMany({
      where: { jobId: id, status: { in: ['FAILED', 'CANCELLED'] } },
      data: { status: 'PENDING', attempts: 0, error: null, bytesDone: 0 },
    });
    if (reset.count === 0) throw badRequest('No hay ítems fallidos que reintentar');

    await redis.del(cancelKey(id));
    await prisma.transferJob.update({
      where: { id },
      data: { status: 'QUEUED', itemsFailed: 0, finishedAt: null, error: null },
    });
    await transferQueue.add('run', { jobId: id, userId: req.userId, onConflict: 'rename' });
    return { ok: true, retried: reset.count };
  });
}
