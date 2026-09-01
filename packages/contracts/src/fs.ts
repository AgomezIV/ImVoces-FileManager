import { z } from 'zod';

export const entryKindSchema = z.enum(['file', 'folder']);

/** Entrada de directorio ya normalizada: la UI no sabe de qué proveedor viene. */
export const remoteEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: entryKindSchema,
  size: z.number().nonnegative().default(0),
  mimeType: z.string().nullable().default(null),
  modifiedAt: z.string().nullable().default(null),
  nativeId: z.string().nullable().default(null),
  /** Google Docs/Sheets: no tienen bytes propios, se exportan al descargar. */
  isExportable: z.boolean().default(false),
  thumbnailUrl: z.string().nullable().default(null),
});
export type RemoteEntry = z.infer<typeof remoteEntrySchema>;

export const listQuerySchema = z.object({
  accountId: z.string().min(1),
  path: z.string().default('/'),
  cursor: z.string().optional(),
  pageSize: z.coerce.number().int().min(1).max(1000).default(200),
});

export const listResponseSchema = z.object({
  entries: z.array(remoteEntrySchema),
  nextCursor: z.string().nullable(),
  path: z.string(),
});
export type ListResponse = z.infer<typeof listResponseSchema>;

export const createFolderSchema = z.object({
  accountId: z.string().min(1),
  parentPath: z.string().default('/'),
  name: z.string().min(1).max(255),
});

export const renameSchema = z.object({
  accountId: z.string().min(1),
  path: z.string().min(1),
  newName: z.string().min(1).max(255),
});

export const deleteSchema = z.object({
  accountId: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1).max(500),
});

export const searchQuerySchema = z.object({
  accountId: z.string().min(1),
  q: z.string().min(1).max(200),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
