import type { Readable } from 'node:stream';
import type { ProviderIdValue, RemoteEntry } from '@imvoces/contracts';

export type { ProviderIdValue, RemoteEntry };

export interface ProviderCapabilities {
  /** El proveedor sabe copiar entre dos rutas suyas sin mover bytes por la red. */
  serverSideCopy: boolean;
  /** Subida por partes (multipart / resumable upload). */
  multipart: boolean;
  /** Descarga reanudable por rango de bytes (`Range`). */
  rangeRead: boolean;
  /** Tiene carpetas reales (Drive) o solo prefijos (S3/R2). */
  realFolders: boolean;
  search: boolean;
  quota: boolean;
  /** Expone un checksum fiable del objeto para verificar la copia. */
  checksum: boolean;
}

export interface ByteRange {
  start: number;
  end?: number;
}

export interface WriteMeta {
  size?: number;
  mimeType?: string;
}

/**
 * Sumidero de escritura por partes. El motor de transferencias empuja chunks y,
 * al terminar, llama a `complete()`. `resumeState()` devuelve lo necesario para
 * continuar el mismo upload tras una caída del worker.
 */
export interface WritableSink {
  write(chunk: Uint8Array): Promise<void>;
  complete(): Promise<RemoteEntry>;
  abort(): Promise<void>;
  resumeState(): unknown;
}

export interface ListOptions {
  cursor?: string;
  pageSize?: number;
}

export interface Page<T> {
  entries: T[];
  nextCursor: string | null;
}

/** Ruta dentro de una cuenta ya resuelta (el `accountId` lo maneja la capa superior). */
export interface Ref {
  path: string;
  nativeId?: string | null;
}

export interface StorageProvider {
  readonly id: ProviderIdValue;
  readonly capabilities: ProviderCapabilities;

  list(ref: Ref, opts?: ListOptions): Promise<Page<RemoteEntry>>;
  stat(ref: Ref): Promise<RemoteEntry>;
  mkdir(parent: Ref, name: string): Promise<RemoteEntry>;
  remove(ref: Ref): Promise<void>;
  rename(ref: Ref, newName: string): Promise<RemoteEntry>;

  openRead(ref: Ref, range?: ByteRange): Promise<Readable>;
  openWrite(dest: Ref, meta: WriteMeta, resume?: unknown): Promise<WritableSink>;

  /** Copia nativa dentro del mismo proveedor y cuenta. Ausente = no soportada. */
  copyWithin?(src: Ref, dest: Ref): Promise<RemoteEntry>;
  signedUrl?(ref: Ref, ttlSeconds: number): Promise<string>;
  search?(query: string, pageSize: number): Promise<RemoteEntry[]>;
  quota?(): Promise<{ used: number | null; total: number | null }>;

  /** Identificador de la cuenta en el proveedor (email, bucket…), para etiquetar y deduplicar. */
  identify(): Promise<{ externalId: string; label: string }>;
}

/** Error normalizado: el motor decide reintentar o no a partir de `retryable`. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
