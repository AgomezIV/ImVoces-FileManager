import { PassThrough, type Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import type { RemoteEntry } from '@imvoces/contracts';
import type {
  ByteRange, ListOptions, Page, ProviderCapabilities, ProviderIdValue,
  Ref, StorageProvider, WritableSink, WriteMeta,
} from '../types.js';
import { ProviderError, toProviderError } from '../errors.js';
import { basename, dirname, joinPath, normalizePath, segments } from '../paths.js';

export interface DriveCredentials {
  accessToken?: string;
  refreshToken: string;
  expiryDate?: number;
  scopes?: string[];
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,parents,thumbnailLink,md5Checksum';

/** Los formatos nativos de Google no tienen bytes: hay que exportarlos. */
const EXPORT_MAP: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx',
  },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
};

export function isGoogleNative(mimeType: string | null | undefined): boolean {
  return !!mimeType && mimeType.startsWith('application/vnd.google-apps.') && mimeType !== FOLDER_MIME;
}

export function exportTargetFor(mimeType: string): { mimeType: string; extension: string } {
  return EXPORT_MAP[mimeType] ?? { mimeType: 'application/pdf', extension: '.pdf' };
}

/**
 * Driver de Google Drive (API v3).
 *
 * Drive no es un árbol de rutas sino un grafo de IDs, así que este driver mantiene
 * una caché ruta→fileId dentro de la instancia para no re-resolver el mismo prefijo
 * en cada operación de un job.
 */
export class GoogleDriveProvider implements StorageProvider {
  readonly id: ProviderIdValue = 'GDRIVE';
  readonly capabilities: ProviderCapabilities = {
    serverSideCopy: true,
    multipart: true,
    rangeRead: true,
    realFolders: true,
    search: true,
    quota: true,
    checksum: true,
  };

  private readonly drive: drive_v3.Drive;
  private readonly auth: OAuth2Client;
  private readonly idCache = new Map<string, string>([['/', 'root']]);

  constructor(
    creds: DriveCredentials,
    clientId: string,
    clientSecret: string,
    /** Se invoca cuando google-auth-library refresca el token, para persistirlo. */
    private readonly onTokens?: (creds: DriveCredentials) => void | Promise<void>,
  ) {
    this.auth = new OAuth2Client({ clientId, clientSecret });
    this.auth.setCredentials({
      access_token: creds.accessToken,
      refresh_token: creds.refreshToken,
      expiry_date: creds.expiryDate,
    });
    this.auth.on('tokens', (tokens) => {
      void this.onTokens?.({
        accessToken: tokens.access_token ?? creds.accessToken,
        refreshToken: tokens.refresh_token ?? creds.refreshToken,
        expiryDate: tokens.expiry_date ?? creds.expiryDate,
        scopes: creds.scopes,
      });
    });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  async identify() {
    try {
      const res = await this.drive.about.get({ fields: 'user(emailAddress,displayName)' });
      const email = res.data.user?.emailAddress ?? 'desconocido';
      return { externalId: email, label: `Google Drive · ${email}` };
    } catch (err) {
      throw toProviderError(err, 'identify');
    }
  }

  /** Resuelve una ruta a fileId navegando segmento a segmento desde 'root'. */
  private async resolveId(path: string): Promise<string> {
    const target = normalizePath(path);
    const cached = this.idCache.get(target);
    if (cached) return cached;

    let parentId = 'root';
    let walked = '';
    for (const segment of segments(target)) {
      walked = joinPath(walked, segment);
      const hit = this.idCache.get(walked);
      if (hit) {
        parentId = hit;
        continue;
      }
      const escaped = segment.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const res = await this.drive.files.list({
        q: `'${parentId}' in parents and name = '${escaped}' and trashed = false`,
        fields: 'files(id,mimeType)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const found = res.data.files?.[0];
      if (!found?.id) {
        throw new ProviderError(`No existe en Drive: ${walked}`, 'NOT_FOUND', false, 404);
      }
      this.idCache.set(walked, found.id);
      parentId = found.id;
    }
    return parentId;
  }

  private async idOf(ref: Ref): Promise<string> {
    if (ref.nativeId) return ref.nativeId;
    return this.resolveId(ref.path);
  }

  private toEntry(file: drive_v3.Schema$File, parentPath: string): RemoteEntry {
    const name = file.name ?? '(sin nombre)';
    const isFolder = file.mimeType === FOLDER_MIME;
    const exportable = isGoogleNative(file.mimeType);
    const path = joinPath(parentPath, name);
    if (file.id) this.idCache.set(path, file.id);
    return {
      name,
      path,
      kind: isFolder ? 'folder' : 'file',
      size: Number(file.size ?? 0),
      mimeType: file.mimeType ?? null,
      modifiedAt: file.modifiedTime ?? null,
      nativeId: file.id ?? null,
      isExportable: exportable,
      thumbnailUrl: file.thumbnailLink ?? null,
    };
  }

  async list(ref: Ref, opts: ListOptions = {}): Promise<Page<RemoteEntry>> {
    try {
      const parentId = await this.idOf(ref);
      const res = await this.drive.files.list({
        q: `'${parentId}' in parents and trashed = false`,
        fields: `nextPageToken, files(${FIELDS})`,
        pageSize: opts.pageSize ?? 200,
        pageToken: opts.cursor,
        orderBy: 'folder,name',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      return {
        entries: (res.data.files ?? []).map((f) => this.toEntry(f, ref.path)),
        nextCursor: res.data.nextPageToken ?? null,
      };
    } catch (err) {
      throw toProviderError(err, `list ${ref.path}`);
    }
  }

  async stat(ref: Ref): Promise<RemoteEntry> {
    try {
      const id = await this.idOf(ref);
      const res = await this.drive.files.get({
        fileId: id, fields: FIELDS, supportsAllDrives: true,
      });
      return this.toEntry(res.data, dirname(ref.path));
    } catch (err) {
      throw toProviderError(err, `stat ${ref.path}`);
    }
  }

  async mkdir(parent: Ref, name: string): Promise<RemoteEntry> {
    try {
      const parentId = await this.idOf(parent);
      const res = await this.drive.files.create({
        requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
        fields: FIELDS,
        supportsAllDrives: true,
      });
      return this.toEntry(res.data, parent.path);
    } catch (err) {
      throw toProviderError(err, `mkdir ${parent.path}/${name}`);
    }
  }

  async remove(ref: Ref): Promise<void> {
    try {
      const id = await this.idOf(ref);
      // A la papelera, no borrado permanente: es reversible desde Drive.
      await this.drive.files.update({
        fileId: id, requestBody: { trashed: true }, supportsAllDrives: true,
      });
      this.idCache.delete(normalizePath(ref.path));
    } catch (err) {
      throw toProviderError(err, `delete ${ref.path}`);
    }
  }

  async rename(ref: Ref, newName: string): Promise<RemoteEntry> {
    try {
      const id = await this.idOf(ref);
      const res = await this.drive.files.update({
        fileId: id, requestBody: { name: newName }, fields: FIELDS, supportsAllDrives: true,
      });
      this.idCache.delete(normalizePath(ref.path));
      return this.toEntry(res.data, dirname(ref.path));
    } catch (err) {
      throw toProviderError(err, `rename ${ref.path}`);
    }
  }

  async copyWithin(src: Ref, dest: Ref): Promise<RemoteEntry> {
    try {
      const srcId = await this.idOf(src);
      const parentId = await this.resolveId(dirname(dest.path));
      const res = await this.drive.files.copy({
        fileId: srcId,
        requestBody: { name: basename(dest.path), parents: [parentId] },
        fields: FIELDS,
        supportsAllDrives: true,
      });
      return this.toEntry(res.data, dirname(dest.path));
    } catch (err) {
      throw toProviderError(err, `copy ${src.path} → ${dest.path}`);
    }
  }

  async openRead(ref: Ref, range?: ByteRange): Promise<Readable> {
    try {
      const id = await this.idOf(ref);
      const meta = await this.drive.files.get({
        fileId: id, fields: 'mimeType', supportsAllDrives: true,
      });
      const mimeType = meta.data.mimeType ?? '';

      if (isGoogleNative(mimeType)) {
        // Los nativos de Google no admiten Range: se exportan enteros.
        const res = await this.drive.files.export(
          { fileId: id, mimeType: exportTargetFor(mimeType).mimeType },
          { responseType: 'stream' },
        );
        return res.data as unknown as Readable;
      }

      const res = await this.drive.files.get(
        { fileId: id, alt: 'media', supportsAllDrives: true },
        {
          responseType: 'stream',
          headers: range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : undefined,
        },
      );
      return res.data as unknown as Readable;
    } catch (err) {
      throw toProviderError(err, `read ${ref.path}`);
    }
  }

  async openWrite(dest: Ref, meta: WriteMeta): Promise<WritableSink> {
    const parentPath = dirname(dest.path);
    const parentId = await this.resolveId(parentPath).catch((err) => {
      throw toProviderError(err, `resolver destino ${parentPath}`);
    });

    // googleapis consume un stream para la subida resumible; el sink lo alimenta.
    const body = new PassThrough();
    const upload = this.drive.files.create(
      {
        requestBody: { name: basename(dest.path), parents: [parentId] },
        media: { mimeType: meta.mimeType ?? 'application/octet-stream', body },
        fields: FIELDS,
        supportsAllDrives: true,
      },
      { onUploadProgress: undefined },
    );
    // Sin este catch, un fallo de la subida sería una promesa rechazada sin
    // manejar antes de que complete() la espere.
    upload.catch(() => undefined);

    const toEntry = this.toEntry.bind(this);
    return {
      async write(chunk: Uint8Array) {
        if (!body.write(Buffer.from(chunk))) {
          await new Promise<void>((resolve) => body.once('drain', () => resolve()));
        }
      },
      async complete() {
        body.end();
        try {
          const res = await upload;
          return toEntry(res.data, parentPath);
        } catch (err) {
          throw toProviderError(err, `subir ${dest.path}`);
        }
      },
      async abort() {
        body.destroy(new Error('Subida abortada'));
        await upload.catch(() => undefined);
      },
      resumeState() {
        // La subida resumible de Drive vive dentro del cliente: al reintentar se
        // empieza de nuevo. Se reintenta el ítem completo, no la parte.
        return null;
      },
    };
  }

  async signedUrl(ref: Ref, _ttlSeconds: number): Promise<string> {
    // Drive no emite URLs firmadas; se sirve el enlace de vista, que exige sesión.
    const id = await this.idOf(ref);
    return `https://drive.google.com/file/d/${id}/view`;
  }

  async search(query: string, pageSize: number): Promise<RemoteEntry[]> {
    try {
      const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const res = await this.drive.files.list({
        q: `name contains '${escaped}' and trashed = false`,
        fields: `files(${FIELDS})`,
        pageSize,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      // La búsqueda global de Drive no devuelve la ruta: se muestran bajo '/'.
      return (res.data.files ?? []).map((f) => this.toEntry(f, '/'));
    } catch (err) {
      throw toProviderError(err, `search ${query}`);
    }
  }

  async quota(): Promise<{ used: number | null; total: number | null }> {
    try {
      const res = await this.drive.about.get({ fields: 'storageQuota' });
      const q = res.data.storageQuota;
      return {
        used: q?.usage != null ? Number(q.usage) : null,
        total: q?.limit != null ? Number(q.limit) : null,
      };
    } catch (err) {
      throw toProviderError(err, 'quota');
    }
  }
}
