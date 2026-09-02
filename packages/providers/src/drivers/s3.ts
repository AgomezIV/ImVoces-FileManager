import type { Readable } from 'node:stream';
import {
  S3Client,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { RemoteEntry } from '@imvoces/contracts';
import type {
  ByteRange, ListOptions, Page, ProviderCapabilities, ProviderIdValue,
  Ref, StorageProvider, WritableSink, WriteMeta,
} from '../types.js';
import { toProviderError } from '../errors.js';
import { basename, dirname, joinPath, normalizePath, normalizeRoot, stripRoot, withRoot } from '../paths.js';

export interface S3Credentials {
  provider: 'R2' | 'S3';
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /**
   * Prefijo raiz dentro del bucket. Toda ruta se resuelve por debajo de el y
   * nada fuera es alcanzable, ni siquiera con una ruta manipulada.
   *
   * Es lo que permite el almacenamiento gestionado: un unico bucket del
   * operador con `users/<userId>/` por persona, sin que nadie vea lo ajeno.
   * Vacio = el bucket entero (cuenta propia del usuario).
   */
  rootPrefix?: string;
}

/** S3 exige partes de ≥5 MiB (salvo la última). */
const MIN_PART_BYTES = 5 * 1024 * 1024;

interface MultipartResume {
  uploadId: string;
  parts: { PartNumber: number; ETag: string }[];
}

/**
 * Driver para almacenes compatibles con S3: Cloudflare R2, AWS S3, Backblaze B2…
 * El espacio de claves es plano; las "carpetas" son prefijos terminados en '/'.
 */
export class S3Provider implements StorageProvider {
  readonly id: ProviderIdValue;
  readonly capabilities: ProviderCapabilities = {
    serverSideCopy: true,
    multipart: true,
    rangeRead: true,
    realFolders: false,
    search: true,
    quota: false,
    checksum: true,
  };

  private readonly client: S3Client;
  private readonly creds: S3Credentials;

  constructor(creds: S3Credentials) {
    this.creds = creds;
    this.id = creds.provider;
    this.client = new S3Client({
      region: creds.region || 'auto',
      endpoint: creds.endpoint,
      forcePathStyle: creds.forcePathStyle,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    });
  }

  private get root(): string {
    return normalizeRoot(this.creds.rootPrefix);
  }

  private toKey(path: string): string {
    return withRoot(this.creds.rootPrefix, path);
  }

  private toPath(key: string): string {
    return stripRoot(this.creds.rootPrefix, key);
  }

  async identify() {
    return { externalId: `${this.creds.bucket}`, label: `${this.creds.provider} · ${this.creds.bucket}` };
  }

  async list(ref: Ref, opts: ListOptions = {}): Promise<Page<RemoteEntry>> {
    const prefixKey = this.toKey(ref.path);
    const prefix = prefixKey === '' ? '' : `${prefixKey}/`;
    try {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.creds.bucket,
          Prefix: prefix,
          Delimiter: '/',
          MaxKeys: opts.pageSize ?? 200,
          ContinuationToken: opts.cursor,
        }),
      );

      const folders: RemoteEntry[] = (res.CommonPrefixes ?? []).map((p) => {
        const key = (p.Prefix ?? '').replace(/\/$/, '');
        return {
          name: basename(this.toPath(key)),
          path: this.toPath(key),
          kind: 'folder' as const,
          size: 0,
          mimeType: null,
          modifiedAt: null,
          nativeId: key,
          isExportable: false,
          thumbnailUrl: null,
        };
      });

      const files: RemoteEntry[] = (res.Contents ?? [])
        // El marcador de carpeta (clave que termina en '/') no es un archivo.
        .filter((o) => o.Key !== undefined && o.Key !== prefix && !o.Key.endsWith('/'))
        .map((o) => ({
          name: basename(this.toPath(o.Key as string)),
          path: this.toPath(o.Key as string),
          kind: 'file' as const,
          size: Number(o.Size ?? 0),
          mimeType: null,
          modifiedAt: o.LastModified?.toISOString() ?? null,
          nativeId: o.Key as string,
          isExportable: false,
          thumbnailUrl: null,
        }));

      return {
        entries: [...folders, ...files],
        nextCursor: res.IsTruncated ? (res.NextContinuationToken ?? null) : null,
      };
    } catch (err) {
      throw toProviderError(err, `list ${ref.path}`);
    }
  }

  async stat(ref: Ref): Promise<RemoteEntry> {
    const key = this.toKey(ref.path);
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.creds.bucket, Key: key }),
      );
      return {
        name: basename(ref.path),
        path: normalizePath(ref.path),
        kind: 'file',
        size: Number(res.ContentLength ?? 0),
        mimeType: res.ContentType ?? null,
        modifiedAt: res.LastModified?.toISOString() ?? null,
        nativeId: key,
        isExportable: false,
        thumbnailUrl: null,
      };
    } catch (err) {
      const pe = toProviderError(err, `stat ${ref.path}`);
      // Un 404 sobre una clave puede significar que es un prefijo (carpeta virtual).
      if (pe.status === 404 || pe.status === 403) {
        const probe = await this.list({ path: ref.path }, { pageSize: 1 });
        if (probe.entries.length > 0) {
          return {
            name: basename(ref.path),
            path: normalizePath(ref.path),
            kind: 'folder',
            size: 0,
            mimeType: null,
            modifiedAt: null,
            nativeId: key,
            isExportable: false,
            thumbnailUrl: null,
          };
        }
      }
      throw pe;
    }
  }

  /** En S3 una carpeta vacía solo existe como objeto marcador de 0 bytes. */
  async mkdir(parent: Ref, name: string): Promise<RemoteEntry> {
    const path = joinPath(parent.path, name);
    try {
      await this.client.send(
        new PutObjectCommand({ Bucket: this.creds.bucket, Key: `${this.toKey(path)}/`, Body: '' }),
      );
    } catch (err) {
      throw toProviderError(err, `mkdir ${path}`);
    }
    return {
      name, path, kind: 'folder', size: 0, mimeType: null,
      modifiedAt: new Date().toISOString(), nativeId: this.toKey(path),
      isExportable: false, thumbnailUrl: null,
    };
  }

  async remove(ref: Ref): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.creds.bucket, Key: this.toKey(ref.path) }),
      );
    } catch (err) {
      throw toProviderError(err, `delete ${ref.path}`);
    }
  }

  /** S3 no renombra: copia a la clave nueva y borra la vieja. */
  async rename(ref: Ref, newName: string): Promise<RemoteEntry> {
    const dest = joinPath(dirname(ref.path), newName);
    const entry = await this.copyWithin(ref, { path: dest });
    await this.remove(ref);
    return entry;
  }

  async copyWithin(src: Ref, dest: Ref): Promise<RemoteEntry> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.creds.bucket,
          CopySource: `${this.creds.bucket}/${this.toKey(src.path)}`,
          Key: this.toKey(dest.path),
        }),
      );
    } catch (err) {
      throw toProviderError(err, `copy ${src.path} → ${dest.path}`);
    }
    return this.stat(dest);
  }

  async openRead(ref: Ref, range?: ByteRange): Promise<Readable> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.creds.bucket,
          Key: this.toKey(ref.path),
          Range: range ? `bytes=${range.start}-${range.end ?? ''}` : undefined,
        }),
      );
      return res.Body as Readable;
    } catch (err) {
      throw toProviderError(err, `read ${ref.path}`);
    }
  }

  async openWrite(dest: Ref, meta: WriteMeta, resume?: unknown): Promise<WritableSink> {
    const key = this.toKey(dest.path);
    const prior = resume as MultipartResume | undefined;
    let uploadId = prior?.uploadId;
    const parts: { PartNumber: number; ETag: string }[] = prior?.parts ? [...prior.parts] : [];

    if (!uploadId) {
      try {
        const res = await this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: this.creds.bucket,
            Key: key,
            ContentType: meta.mimeType ?? 'application/octet-stream',
          }),
        );
        uploadId = res.UploadId as string;
      } catch (err) {
        throw toProviderError(err, `iniciar multipart ${dest.path}`);
      }
    }

    const client = this.client;
    const bucket = this.creds.bucket;
    let buffer: Buffer[] = [];
    let buffered = 0;
    let partNumber = parts.length;
    const self = this;

    async function flush(force: boolean): Promise<void> {
      if (buffered === 0 || (!force && buffered < MIN_PART_BYTES)) return;
      const body = Buffer.concat(buffer, buffered);
      buffer = [];
      buffered = 0;
      partNumber += 1;
      const res = await client.send(
        new UploadPartCommand({
          Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber, Body: body,
        }),
      );
      parts.push({ PartNumber: partNumber, ETag: res.ETag as string });
    }

    return {
      async write(chunk: Uint8Array) {
        buffer.push(Buffer.from(chunk));
        buffered += chunk.byteLength;
        try {
          await flush(false);
        } catch (err) {
          throw toProviderError(err, `subir parte ${partNumber + 1} de ${dest.path}`);
        }
      },
      async complete() {
        try {
          await flush(true);
          await client.send(
            new CompleteMultipartUploadCommand({
              Bucket: bucket, Key: key, UploadId: uploadId,
              MultipartUpload: { Parts: parts },
            }),
          );
        } catch (err) {
          throw toProviderError(err, `completar multipart ${dest.path}`);
        }
        return self.stat(dest);
      },
      async abort() {
        // Abortar es best-effort: el fallo original ya se está propagando.
        await client
          .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
          .catch(() => undefined);
      },
      resumeState() {
        return { uploadId, parts } satisfies MultipartResume;
      },
    };
  }

  async signedUrl(ref: Ref, ttlSeconds: number): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.creds.bucket, Key: this.toKey(ref.path) }),
        { expiresIn: ttlSeconds },
      );
    } catch (err) {
      throw toProviderError(err, `signedUrl ${ref.path}`);
    }
  }

  /** S3 no tiene búsqueda: se filtra por subcadena sobre el listado del bucket. */
  async search(query: string, pageSize: number): Promise<RemoteEntry[]> {
    const needle = query.toLowerCase();
    const out: RemoteEntry[] = [];
    let cursor: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.creds.bucket,
          // Acotado al prefijo raiz: la busqueda nunca cruza a otro usuario.
          Prefix: this.root ? `${this.root}/` : undefined,
          MaxKeys: 1000,
          ContinuationToken: cursor,
        }),
      );
      for (const o of res.Contents ?? []) {
        const k = o.Key;
        if (!k || k.endsWith('/')) continue;
        if (!k.toLowerCase().includes(needle)) continue;
        out.push({
          name: basename(this.toPath(k)),
          path: this.toPath(k),
          kind: 'file',
          size: Number(o.Size ?? 0),
          mimeType: null,
          modifiedAt: o.LastModified?.toISOString() ?? null,
          nativeId: k,
          isExportable: false,
          thumbnailUrl: null,
        });
        if (out.length >= pageSize) return out;
      }
      cursor = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (cursor);
    return out;
  }
}
