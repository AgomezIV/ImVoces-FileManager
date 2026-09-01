import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { prisma, type TransferItem } from '@imvoces/db';
import { env } from './env.js';
import {
  ProviderCache, expandItem, isCancelled, runItemWithRetries, verifyCopy,
  type ConflictPolicy, type ProgressSink,
} from './engine.js';

const log = pino({ level: env.NODE_ENV === 'development' ? 'debug' : 'info' });
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const publisher = connection.duplicate();

interface TransferJobData {
  jobId: string;
  userId: string;
  onConflict: ConflictPolicy;
}

const channel = (jobId: string) => `transfer:${jobId}`;

function makeSink(jobId: string): ProgressSink {
  return {
    publish(payload) {
      void publisher.publish(channel(jobId), JSON.stringify(payload));
    },
    itemProgress(item, bytesDone) {
      void publisher.publish(
        channel(jobId),
        JSON.stringify({
          type: 'item',
          itemId: item.id,
          status: 'RUNNING',
          bytesDone,
          size: Number(item.size),
        }),
      );
    },
  };
}

/**
 * Fase 1 — expansión: cada ítem seleccionado se convierte en ítems-archivo.
 * Se hace en una transacción por ítem original para que un fallo de listado
 * no deje el job a medio expandir sin traza.
 */
async function expandJob(jobId: string, providers: ProviderCache): Promise<void> {
  await prisma.transferJob.update({
    where: { id: jobId },
    data: { status: 'EXPANDING', startedAt: new Date() },
  });

  const seeds = await prisma.transferItem.findMany({ where: { jobId, status: 'PENDING' } });

  for (const seed of seeds) {
    const files = await expandItem(seed, providers);

    // Un solo archivo: el ítem semilla ya es el ítem final, solo se anota el tamaño.
    if (files.length === 1 && files[0]?.srcPath === seed.srcPath) {
      await prisma.transferItem.update({
        where: { id: seed.id },
        data: { size: BigInt(files[0].size), srcNativeId: files[0].nativeId },
      });
      continue;
    }

    // Carpeta: se sustituye la semilla por sus archivos.
    await prisma.$transaction([
      prisma.transferItem.createMany({
        data: files.map((f) => ({
          jobId,
          srcAccountId: seed.srcAccountId,
          srcPath: f.srcPath,
          srcNativeId: f.nativeId,
          destAccountId: seed.destAccountId,
          destPath: f.destPath,
          size: BigInt(f.size),
        })),
        skipDuplicates: true, // la clave única (job,src,dest) hace la expansión idempotente
      }),
      prisma.transferItem.delete({ where: { id: seed.id } }),
    ]);
  }

  const agg = await prisma.transferItem.aggregate({
    where: { jobId },
    _count: true,
    _sum: { size: true },
  });
  await prisma.transferJob.update({
    where: { id: jobId },
    data: {
      status: 'RUNNING',
      itemsTotal: agg._count,
      totalBytes: agg._sum.size ?? BigInt(0),
    },
  });
}

/** Fase 2 — ejecución: N ítems en paralelo, respetando la cancelación cooperativa. */
async function runJob(job: Job<TransferJobData>): Promise<void> {
  const { jobId, onConflict } = job.data;
  const providers = new ProviderCache();
  const sink = makeSink(jobId);

  await expandJob(jobId, providers);

  const pending = await prisma.transferItem.findMany({
    where: { jobId, status: 'PENDING' },
    orderBy: { size: 'asc' }, // los pequeños primero: progreso visible enseguida
  });

  const queue = [...pending];
  const workers = Array.from({ length: env.TRANSFER_CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      if (await isCancelled(connection, jobId)) return;
      await processItem(item, providers, onConflict, sink);
    }
  });
  await Promise.all(workers);

  const [failed, done] = await Promise.all([
    prisma.transferItem.count({ where: { jobId, status: 'FAILED' } }),
    prisma.transferItem.count({ where: { jobId, status: { in: ['DONE', 'SKIPPED'] } } }),
  ]);
  const cancelled = await isCancelled(connection, jobId);
  const status = cancelled
    ? 'CANCELLED'
    : failed === 0
      ? 'COMPLETED'
      : done === 0
        ? 'FAILED'
        : 'COMPLETED_WITH_ERRORS';

  const finished = await prisma.transferJob.update({
    where: { id: jobId },
    data: { status, itemsDone: done, itemsFailed: failed, finishedAt: new Date() },
  });
  sink.publish({ type: 'done', status: finished.status });
  log.info({ jobId, status, done, failed }, 'job terminado');
}

async function processItem(
  item: TransferItem,
  providers: ProviderCache,
  policy: ConflictPolicy,
  sink: ProgressSink,
): Promise<void> {
  await prisma.transferItem.update({
    where: { id: item.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  try {
    const result = await runItemWithRetries(item, providers, policy, sink);

    if (result.skipped) {
      await prisma.transferItem.update({
        where: { id: item.id },
        data: { status: 'SKIPPED', finishedAt: new Date(), attempts: result.attempts },
      });
      sink.publish({
        type: 'item', itemId: item.id, status: 'SKIPPED',
        bytesDone: 0, size: Number(item.size),
      });
      return;
    }

    const dest = await providers.get(item.destAccountId);
    const verified = await verifyCopy(dest, result.destPath, Number(item.size));

    // MOVE: el origen solo se borra tras verificar el destino. Nunca antes.
    const job = await prisma.transferJob.findUniqueOrThrow({ where: { id: item.jobId } });
    if (job.kind === 'MOVE') {
      const src = await providers.get(item.srcAccountId);
      await src.remove({ path: item.srcPath, nativeId: item.srcNativeId });
    }

    await prisma.$transaction([
      prisma.transferItem.update({
        where: { id: item.id },
        data: {
          status: 'DONE',
          bytesDone: item.size,
          checksum: result.checksum,
          verified,
          attempts: result.attempts,
          finishedAt: new Date(),
          destPath: result.destPath,
          resumeState: undefined,
        },
      }),
      prisma.transferJob.update({
        where: { id: item.jobId },
        data: { itemsDone: { increment: 1 }, doneBytes: { increment: item.size } },
      }),
    ]);
    sink.publish({
      type: 'item', itemId: item.id, status: 'DONE',
      bytesDone: Number(item.size), size: Number(item.size),
    });
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    log.warn({ itemId: item.id, err: message }, 'ítem fallido');
    await prisma.$transaction([
      prisma.transferItem.update({
        where: { id: item.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      }),
      prisma.transferJob.update({
        where: { id: item.jobId },
        data: { itemsFailed: { increment: 1 } },
      }),
    ]);
    sink.publish({
      type: 'item', itemId: item.id, status: 'FAILED',
      bytesDone: 0, size: Number(item.size), error: message,
    });
  }
}

const worker = new Worker<TransferJobData>('transfers', runJob, {
  connection,
  concurrency: 2, // jobs simultáneos; la concurrencia por archivo va dentro de runJob
});

worker.on('failed', (job, err) => {
  log.error({ jobId: job?.data.jobId, err: err.message }, 'job fallido');
  if (job?.data.jobId) {
    void prisma.transferJob
      .update({
        where: { id: job.data.jobId },
        data: { status: 'FAILED', error: err.message.slice(0, 500), finishedAt: new Date() },
      })
      .catch(() => undefined);
  }
});

worker.on('ready', () => log.info('worker de transferencias listo'));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void worker.close().then(() => process.exit(0));
  });
}
