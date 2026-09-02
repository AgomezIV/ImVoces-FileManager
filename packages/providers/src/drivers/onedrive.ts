import { Readable } from 'node:stream';
import type { RemoteEntry } from '@imvoces/contracts';
import type {
  ByteRange, ListOptions, Page, ProviderCapabilities, ProviderIdValue,
  Ref, StorageProvider, WritableSink, WriteMeta,
} from '../types.js';
import { toProviderError } from '../errors.js';
import { OAuthSession, type OAuthCredentials } from '../oauth.js';
import { basename, dirname, joinPath, normalizePath } from '../paths.js';

export type OneDriveCredentials = OAuthCredentials;

export const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
export const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
/** `offline_access` es lo que da refresh token; sin el habria que reconectar cada hora. */
export const MS_SCOPES = ['offline_access', 'User.Read', 'Files.ReadWrite'];

const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Graph exige que cada trozo sea multiplo de 320 KiB. */
const CHUNK_BYTES = 320 * 1024 * 20; // 6.4 MiB

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType?: string };
  '@microsoft.graph.downloadUrl'?: string;
  parentReference?: { path?: string };
}

/**
 * Driver de OneDrive sobre Microsoft Graph.
 *
 * Como Dropbox: el usuario entra con su cuenta Microsoft de siempre y concede
 * permiso. Ninguna clave de API pasa por sus manos.
 */
export class OneDriveProvider implements StorageProvider {
  readonly id: ProviderIdValue = 'ONEDRIVE';
  readonly capabilities: ProviderCapabilities = {
    serverSideCopy: true,
    multipart: true,
    rangeRead: true,
    realFolders: true,
    search: true,
    quota: true,
    checksum: false,
  };

  private readonly session: OAuthSession;

  constructor(
    creds: OneDriveCredentials,
    clientId: string,
    clientSecret: string,
    onRefresh?: (next: OneDriveCredentials) => void | Promise<void>,
  ) {
    this.session = new OAuthSession(
      creds,
      { clientId, clientSecret, tokenUrl: MS_TOKEN_URL },
      onRefresh,
    );
  }

  /**
   * Graph direcciona por ruta con la sintaxis `root:/a/b:`; la raiz es `root`
   * a secas. Cada segmento va codificado porque la ruta viaja en la URL.
   */
  private addr(path: string, suffix = ''): string {
    const p = normalizePath(path);
    if (p === '/') return `${GRAPH}/me/drive/root${suffix ? `/${suffix}` : ''}`;
    const encoded = p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return `${GRAPH}/me/drive/root:/${encoded}:${suffix ? `/${suffix}` : ''}`;
  }

  private toEntry(item: GraphItem, parentPath: string): RemoteEntry {
    return {
      name: item.name,
      path: joinPath(parentPath, item.name),
      kind: item.folder ? 'folder' : 'file',
      size: item.size ?? 0,
      mimeType: item.file?.mimeType ?? null,
      modifiedAt: item.lastModifiedDateTime ?? null,
      nativeId: item.id,
      isExportable: false,
      thumbnailUrl: null,
    };
  }

  async identify() {
    const me = await this.session.json<{ userPrincipalName?: string; mail?: string; displayName?: string }>(
      `${GRAPH}/me`,
      { method: 'GET' },
      'identify',
    );
    const email = me.mail ?? me.userPrincipalName ?? 'desconocido';
    return { externalId: email, label: `OneDrive · ${email}` };
  }

  async list(ref: Ref, opts: ListOptions = {}): Promise<Page<RemoteEntry>> {
    // Graph devuelve la pagina siguiente como URL completa: se usa tal cual.
    const url = opts.cursor ?? `${this.addr(ref.path, 'children')}?$top=${opts.pageSize ?? 200}`;
    const res = await this.session.json<{ value: GraphItem[]; '@odata.nextLink'?: string }>(
      url,
      { method: 'GET' },
      `list ${ref.path}`,
    );
    return {
      entries: res.value.map((i) => this.toEntry(i, ref.path)),
      nextCursor: res['@odata.nextLink'] ?? null,
    };
  }

  async stat(ref: Ref): Promise<RemoteEntry> {
    const item = await this.session.json<GraphItem>(
      this.addr(ref.path),
      { method: 'GET' },
      `stat ${ref.path}`,
    );
    return this.toEntry(item, dirname(ref.path));
  }

  async mkdir(parent: Ref, name: string): Promise<RemoteEntry> {
    const item = await this.session.json<GraphItem>(
      this.addr(parent.path, 'children'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      },
      `mkdir ${parent.path}/${name}`,
    );
    return this.toEntry(item, parent.path);
  }

  async remove(ref: Ref): Promise<void> {
    await this.session.request(this.addr(ref.path), { method: 'DELETE' }, `delete ${ref.path}`);
  }

  async rename(ref: Ref, newName: string): Promise<RemoteEntry> {
    const item = await this.session.json<GraphItem>(
      this.addr(ref.path),
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      },
      `rename ${ref.path}`,
    );
    return this.toEntry(item, dirname(ref.path));
  }

  async openRead(ref: Ref, range?: ByteRange): Promise<Readable> {
    const res = await this.session.request(
      this.addr(ref.path, 'content'),
      { method: 'GET', headers: range ? { Range: `bytes=${range.start}-${range.end ?? ''}` } : {} },
      `read ${ref.path}`,
    );
    if (!res.body) throw toProviderError(new Error('respuesta sin cuerpo'), `read ${ref.path}`);
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  /**
   * Sesion de subida de Graph: cada PUT lleva su Content-Range y el servidor
   * va ensamblando. El tamano total debe conocerse de antemano.
   */
  async openWrite(dest: Ref, meta: WriteMeta): Promise<WritableSink> {
    const session = this.session;
    const toEntry = this.toEntry.bind(this);
    const parentPath = dirname(dest.path);
    const total = meta.size ?? 0;

    const created = await session.json<{ uploadUrl: string }>(
      this.addr(dest.path, 'createUploadSession'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: { '@microsoft.graph.conflictBehavior': 'replace' },
        }),
      },
      `iniciar subida ${dest.path}`,
    );
    const uploadUrl = created.uploadUrl;

    let offset = 0;
    let buffer: Buffer[] = [];
    let buffered = 0;
    let finished: GraphItem | null = null;

    const flush = async (force: boolean): Promise<void> => {
      if (buffered === 0 || (!force && buffered < CHUNK_BYTES)) return;
      const body = Buffer.concat(buffer, buffered);
      buffer = [];
      buffered = 0;

      const end = offset + body.length - 1;
      // La URL de subida ya lleva su propia autorizacion: no se manda Bearer.
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(body.length),
          'Content-Range': `bytes ${offset}-${end}/${total || end + 1}`,
        },
        body,
      });
      if (!res.ok && res.status !== 202) {
        const detail = await res.text().catch(() => '');
        throw toProviderError(
          { status: res.status, message: detail.slice(0, 300) },
          `subir trozo de ${dest.path}`,
        );
      }
      // 200/201 en el ultimo trozo trae ya el item creado.
      if (res.status === 200 || res.status === 201) {
        finished = (await res.json()) as GraphItem;
      }
      offset += body.length;
    };

    return {
      async write(chunk: Uint8Array) {
        buffer.push(Buffer.from(chunk));
        buffered += chunk.byteLength;
        await flush(false);
      },
      async complete() {
        await flush(true);
        if (finished) return toEntry(finished, parentPath);
        // Archivo de 0 bytes: la sesion no llego a recibir nada.
        const item = await session.json<GraphItem>(
          `${GRAPH}/me/drive/root:/${normalizePath(dest.path).slice(1)}:/content`,
          { method: 'PUT', body: Buffer.alloc(0) },
          `subir ${dest.path}`,
        );
        return toEntry(item, parentPath);
      },
      async abort() {
        await fetch(uploadUrl, { method: 'DELETE' }).catch(() => undefined);
      },
      resumeState() {
        return { uploadUrl, offset };
      },
    };
  }

  async signedUrl(ref: Ref, _ttlSeconds: number): Promise<string> {
    const item = await this.session.json<GraphItem>(
      `${this.addr(ref.path)}?select=id,@microsoft.graph.downloadUrl`,
      { method: 'GET' },
      `signedUrl ${ref.path}`,
    );
    const url = item['@microsoft.graph.downloadUrl'];
    if (!url) throw toProviderError(new Error('sin enlace de descarga'), `signedUrl ${ref.path}`);
    return url;
  }

  async search(query: string, pageSize: number): Promise<RemoteEntry[]> {
    const res = await this.session.json<{ value: GraphItem[] }>(
      `${GRAPH}/me/drive/root/search(q='${encodeURIComponent(query)}')?$top=${pageSize}`,
      { method: 'GET' },
      `search ${query}`,
    );
    // La busqueda no devuelve la ruta completa fiable: se muestran bajo '/'.
    return res.value.map((i) => this.toEntry(i, '/'));
  }

  async quota(): Promise<{ used: number | null; total: number | null }> {
    const drive = await this.session.json<{ quota?: { used?: number; total?: number } }>(
      `${GRAPH}/me/drive`,
      { method: 'GET' },
      'quota',
    );
    return { used: drive.quota?.used ?? null, total: drive.quota?.total ?? null };
  }
}
