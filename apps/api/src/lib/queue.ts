import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../env.js';

export const TRANSFER_QUEUE = 'transfers';

/** BullMQ exige maxRetriesPerRequest: null en las conexiones que bloquean. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const transferQueue = new Queue(TRANSFER_QUEUE, { connection: redis });

/** Canal pub/sub por job: el worker publica progreso y la API lo reenvía por SSE. */
export const jobChannel = (jobId: string) => `transfer:${jobId}`;

/** Bandera de cancelación consultada por el worker entre ítems. */
export const cancelKey = (jobId: string) => `transfer:${jobId}:cancelled`;
