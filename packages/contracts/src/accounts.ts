import { z } from 'zod';
import { providerIdSchema } from './common.js';

export const accountStatusSchema = z.enum(['ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISABLED']);

/** Vista pública de una cuenta conectada. Nunca incluye credenciales. */
export const storageAccountSchema = z.object({
  id: z.string(),
  provider: providerIdSchema,
  label: z.string(),
  externalId: z.string(),
  status: accountStatusSchema,
  lastError: z.string().nullable(),
  quotaUsed: z.number().nullable(),
  quotaTotal: z.number().nullable(),
  createdAt: z.string(),
});
export type StorageAccountView = z.infer<typeof storageAccountSchema>;

export const connectStartResponseSchema = z.object({
  authUrl: z.string().url(),
  state: z.string(),
});

/** Alta de una cuenta S3-compatible (Cloudflare R2, S3, B2…) por credenciales. */
export const s3AccountInputSchema = z.object({
  provider: z.enum(['R2', 'S3']).default('R2'),
  label: z.string().min(1).max(60),
  /** R2: https://<accountId>.r2.cloudflarestorage.com — S3: vacío para AWS. */
  endpoint: z.string().url().optional(),
  region: z.string().default('auto'),
  bucket: z.string().min(1),
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  forcePathStyle: z.boolean().default(true),
});
export type S3AccountInput = z.infer<typeof s3AccountInputSchema>;
