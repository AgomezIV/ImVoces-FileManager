import { z } from 'zod';

export const providerIdSchema = z.enum(['GDRIVE', 'R2', 'S3', 'DROPBOX', 'ONEDRIVE']);
export type ProviderIdValue = z.infer<typeof providerIdSchema>;

/**
 * Referencia universal a un objeto remoto.
 * `path` es la ruta normalizada que ve la UI ('/' como separador, sin barra final).
 * `nativeId` es el identificador propio del proveedor (fileId de Drive), opcional:
 * cuando está presente evita una resolución de ruta extra.
 */
export const remoteRefSchema = z.object({
  accountId: z.string().min(1),
  path: z.string().default('/'),
  nativeId: z.string().optional(),
});
export type RemoteRef = z.infer<typeof remoteRefSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
});
