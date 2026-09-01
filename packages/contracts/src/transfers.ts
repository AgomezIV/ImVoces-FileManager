import { z } from 'zod';
import { remoteRefSchema } from './common.js';

export const transferKindSchema = z.enum(['COPY', 'MOVE']);
export const jobStatusSchema = z.enum([
  'QUEUED', 'EXPANDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED',
]);
export const itemStatusSchema = z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED', 'CANCELLED']);

/**
 * El "un clic": una lista de pares origen→destino. El cliente NO expande carpetas;
 * manda la selección tal cual y el worker resuelve el árbol.
 */
export const createTransferSchema = z.object({
  kind: transferKindSchema.default('COPY'),
  items: z
    .array(z.object({ src: remoteRefSchema, dest: remoteRefSchema }))
    .min(1)
    .max(1000),
  /** Qué hacer si el destino ya tiene un archivo con ese nombre. */
  onConflict: z.enum(['rename', 'overwrite', 'skip']).default('rename'),
});
export type CreateTransferRequest = z.infer<typeof createTransferSchema>;

export const transferItemSchema = z.object({
  id: z.string(),
  srcAccountId: z.string(),
  srcPath: z.string(),
  destAccountId: z.string(),
  destPath: z.string(),
  size: z.number(),
  bytesDone: z.number(),
  status: itemStatusSchema,
  attempts: z.number(),
  error: z.string().nullable(),
});

export const transferJobSchema = z.object({
  id: z.string(),
  kind: transferKindSchema,
  status: jobStatusSchema,
  totalBytes: z.number(),
  doneBytes: z.number(),
  itemsTotal: z.number(),
  itemsDone: z.number(),
  itemsFailed: z.number(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  items: z.array(transferItemSchema).optional(),
});
export type TransferJobView = z.infer<typeof transferJobSchema>;

/** Evento SSE de `GET /transfers/:id/events`. */
export const transferEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job'), job: transferJobSchema }),
  z.object({
    type: z.literal('item'),
    itemId: z.string(),
    status: itemStatusSchema,
    bytesDone: z.number(),
    size: z.number(),
    error: z.string().nullable().optional(),
  }),
  z.object({ type: z.literal('done'), status: jobStatusSchema }),
  z.object({ type: z.literal('ping') }),
]);
export type TransferEvent = z.infer<typeof transferEventSchema>;
