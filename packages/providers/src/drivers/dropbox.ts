import { Readable } from 'node:stream';
import type { RemoteEntry } from '@imvoces/contracts';
import type {
  ByteRange, ListOptions, Page, ProviderCapabilities, ProviderIdValue,
  Ref, StorageProvider, WritableSink, WriteMeta,
} from '../types.js';
import { toProviderError } from '../errors.js';
import { OAuthSession, type OAuthCredentials } from '../oauth.js';
import { basename, dirname, joinPath, normalizePath } from '../paths.js';

export type DropboxCredentials = OAuthCredentials;

export const DROPBOX_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';
export const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
/** Permisos minimos para leer y escribir en el Dropbox del usuario. */
export const DROPBOX_SCOPES = [
  'account_info.read',
  'files.metadata.read',
  'files.content.read',
  'files.content.write',
];

const API = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

/** Trozo de la sesion de subida. Dropbox exige multiplos de 4 MiB salvo el ultimo. */
const CHUNK_BYTES = 8 * 1024 * 1024;

interface DbxEntry {
  '.tag': 'file' | 'folder' | 'deleted';
  name: string;
  path_display?: string;
  path_lower?: string;
  id?: string;
  size?: number;
  server_modified?: string;
  content_hash?: string;
}

/**
 * Driver de Dropbox.
 *
 * Se conecta con la cuenta normal del usuario: pulsa "Conectar", inicia sesion
 * en Dropbox y concede permiso. No hay claves de API por medio.
 */
export class DropboxProvider implements StorageProvider {
  readonly id: ProviderIdValue = 'DROPBOX';
  readonly capabilities: ProviderCapabilities = {
    serverSideCopy: true,
    multipart: true,
    rangeRead: true,
    realFolders: true,
    search: true,
    quota: true,
    checksum: true,
  };

  private readonly session: OAuthSession;

  constructor(
    creds: DropboxCredentials,
    clientId: string,
    clientSecret: string,
    onRefresh?: (next: DropboxCredentials) => void | Promise<void>,
  ) {
    this.session = new OAuthSession(
      creds,
      { clientId, clientSecret, tokenUrl: DROPBOX_TOKEN_URL },
      onRefresh,
    );
  }

  /** Dropbox usa '' para la raiz, no '/'. */
  private toApiPath(path: string): string {
    const p = normalizePath(path);
    return p === '/' ? '' : p;
  }

  private rpc<T>(endpoint: string, body: unknown, context: string): Promise<T> {
    return this.session.json<T>(
      `${API}${endpoint}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      context,
    );
  }

  private toEntry(e: DbxEntry): RemoteEntry {
    const path = normalizePath(e.path_display ?? `/${e.name}`);
    return {
      name: e.name,
      path,
      kind: e['.tag'] === 'folder' ? 'folder' : 'file',
      size: e.size ?? 0,
      mimeType: null,
      modifiedAt: e.server_modified ?? null,
      nativeId: e.id ?? null,
      isExportable: false,
      thumbnailUrl: null,
    };
  }

  async identify() {
    const me = await this.rpc<{ email: string; name?: { display_name?: string } }>(
      '/users/get_current_account',
      null,
      'identify',
    );
    return { externalId: me.email, label: `Dropbox · ${me.email}` };
  }

  async list(ref: Ref, opts: ListOptions = {}): Promise<Page<RemoteEntry>> {
    // El cursor de Dropbox va a un endpoint distinto que la primera pagina.
    const res = opts.cursor
      ? await this.rpc<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(
          '/files/list_folder/continue',
          { cursor: opts.cursor },
          `list ${ref.path}`,
        )
      : await this.rpc<{ entries: DbxEntry[]; cursor: string; has_more: boolean }>(
          '/files/list_folder',
          { path: this.toApiPath(ref.path), limit: opts.pageSize ?? 200 },
          `list ${ref.path}`,
        );

    return {
      entries: res.entries.filter((e) => e['.tag'] !== 'deleted').map((e) => this.toEntry(e)),
      nextCursor: res.has_more ? res.cursor : null,
    };
  }

  async stat(ref: Ref): Promise<RemoteEntry> {
    const path = this.toApiPath(ref.path);
    // La raiz no tiene metadatos propios en Dropbox.
    if (path === '') {
      return {
        name: '/', path: '/', kind: 'folder', size: 0, mimeType: null,
        modifiedAt: null, nativeId: null, isExportable: false, thumbnailUrl: null,
      };
    }
    const e = await this.rpc<DbxEntry>('/files/get_metadata', { path }, `stat ${ref.path}`);
    return this.toEntry(e);
  }

  async mkdir(parent: Ref, name: string): Promise<RemoteEntry> {
    const path = joinPath(parent.path, name);
    const res = await this.rpc<{ metadata: DbxEntry }>(
      '/files/create_folder_v2',
      { path: this.toApiPath(path), autorename: false },
      `mkdir ${path}`,
    );
    return this.toEntry(res.metadata);
  }

  async remove(ref: Ref): Promise<void> {
    await this.rpc('/files/delete_v2', { path: this.toApiPath(ref.path) }, `delete ${ref.path}`);
  }

  async rename(ref: Ref, newName: string): Promise<RemoteEntry> {
    const to = joinPath(dirname(ref.path), newName);
    const res = await this.rpc<{ metadata: DbxEntry }>(
      '/files/move_v2',
      { from_path: this.toApiPath(ref.path), to_path: this.toApiPath(to), autorename: false },
      `rename ${ref.path}`,
    );
    return this.toEntry(res.metadata);
  }

  async copyWithin(src: Ref, dest: Ref): Promise<RemoteEntry> {
    const res = await this.rpc<{ metadata: DbxEntry }>(
      '/files/copy_v2',
      { from_path: this.toApiPath(src.path), to_path: this.toApiPath(dest.path), autorename: false },
      `copy ${src.path} → ${dest.path}`,
    );
    return this.toEntry(res.metadata);
  }

  async openRead(ref: Ref, range?: ByteRange): Promise<Readable> {
    const headers: Record<string, string> = {
      'Dropbox-API-Arg': JSON.stringify({ path: this.toApiPath(ref.path) }),
    };
    if (range) headers.Range = `bytes=${range.start}-${range.end ?? ''}`;

    const res = await this.session.request(
      `${CONTENT}/files/download`,
      { method: 'POST', headers },
      `read ${ref.path}`,
    );
    if (!res.body) throw toProviderError(new Error('respuesta sin cuerpo'), `read ${ref.path}`);
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  /**
   * Subida por sesion: se abre una sesion, se van anexando trozos y se cierra.
   * Asi un archivo de varios GB no pasa nunca entero por memoria.
   */
  async openWrite(dest: Ref, _meta: WriteMeta): Promise<WritableSink> {
    const path = this.toApiPath(dest.path);
    const session = this.session;
    const toEntry = this.toEntry.bind(this);

    let sessionId: string | null = null;
    let offset = 0;
    let buffer: Buffer[] = [];
    let buffered = 0;

    const flush = async (force: boolean): Promise<void> => {
      if (buffered === 0 || (!force && buffered < CHUNK_BYTES)) return;
      const body = Buffer.concat(buffer, buffered);
      buffer = [];
      buffered = 0;

      if (sessionId === null) {
        const started = await session.json<{ session_id: string }>(
          `${CONTENT}/files/upload_session/start`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({ close: false }),
            },
            body,
          },
          `iniciar subida ${dest.path}`,
        );
        sessionId = started.session_id;
      } else {
        await session.request(
          `${CONTENT}/files/upload_session/append_v2`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({
                cursor: { session_id: sessionId, offset },
                close: false,
              }),
            },
            body,
          },
          `subir trozo de ${dest.path}`,
        );
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
        if (sessionId === null) {
          // Archivo vacio: no hubo ni un trozo, se sube directo.
          const meta = await session.json<DbxEntry>(
            `${CONTENT}/files/upload`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
                'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false }),
              },
              body: Buffer.alloc(0),
            },
            `subir ${dest.path}`,
          );
          return toEntry(meta);
        }
        const meta = await session.json<DbxEntry>(
          `${CONTENT}/files/upload_session/finish`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'Dropbox-API-Arg': JSON.stringify({
                cursor: { session_id: sessionId, offset },
                commit: { path, mode: 'overwrite', autorename: false },
              }),
            },
            body: Buffer.alloc(0),
          },
          `cerrar subida ${dest.path}`,
        );
        return toEntry(meta);
      },
      async abort() {
        // Dropbox descarta sola la sesion incompleta a las 48 h: no hay que llamar a nada.
        buffer = [];
        buffered = 0;
      },
      resumeState() {
        return sessionId === null ? null : { sessionId, offset };
      },
    };
  }

  async signedUrl(ref: Ref, _ttlSeconds: number): Promise<string> {
    const res = await this.rpc<{ link: string }>(
      '/files/get_temporary_link',
      { path: this.toApiPath(ref.path) },
      `signedUrl ${ref.path}`,
    );
    return res.link;
  }

  async search(query: string, pageSize: number): Promise<RemoteEntry[]> {
    const res = await this.rpc<{ matches: { metadata: { metadata: DbxEntry } }[] }>(
      '/files/search_v2',
      { query, options: { max_results: Math.min(pageSize, 100) } },
      `search ${query}`,
    );
    return res.matches.map((m) => this.toEntry(m.metadata.metadata));
  }

  async quota(): Promise<{ used: number | null; total: number | null }> {
    const res = await this.rpc<{ used: number; allocation: { allocated?: number } }>(
      '/users/get_space_usage',
      null,
      'quota',
    );
    return { used: res.used ?? null, total: res.allocation?.allocated ?? null };
  }
}
