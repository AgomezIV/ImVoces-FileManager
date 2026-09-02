import type { ProviderIdValue, StorageProvider } from './types.js';
import { decryptJson } from './crypto.js';
import { GoogleDriveProvider, type DriveCredentials } from './drivers/gdrive.js';
import { S3Provider, type S3Credentials } from './drivers/s3.js';
import { DropboxProvider, type DropboxCredentials } from './drivers/dropbox.js';
import { OneDriveProvider, type OneDriveCredentials } from './drivers/onedrive.js';
import type { OAuthCredentials } from './oauth.js';

/** Fila mínima de `StorageAccount` que el registry necesita. */
export interface AccountRecord {
  id: string;
  provider: ProviderIdValue;
  credentialsEnc: string;
}

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
}

export interface RegistryOptions {
  googleClientId: string;
  googleClientSecret: string;
  dropbox?: OAuthAppConfig;
  microsoft?: OAuthAppConfig;
  /** Persiste los tokens cuando el driver los refresca por su cuenta. */
  onDriveTokensRefreshed?: (accountId: string, creds: DriveCredentials) => Promise<void>;
  onOAuthTokensRefreshed?: (accountId: string, creds: OAuthCredentials) => Promise<void>;
}

function requireApp(app: OAuthAppConfig | undefined, provider: string): OAuthAppConfig {
  if (!app?.clientId || !app.clientSecret) {
    throw new Error(
      `${provider} no está configurado en el servidor. ` +
        `Falta su client id/secret en las variables de entorno.`,
    );
  }
  return app;
}

/**
 * Construye el driver correspondiente a una cuenta conectada.
 *
 * Añadir un proveedor nuevo es un `case` aquí y un archivo en `drivers/`:
 * ni la API ni los clientes cambian.
 */
export function providerFor(account: AccountRecord, opts: RegistryOptions): StorageProvider {
  switch (account.provider) {
    case 'GDRIVE': {
      const creds = decryptJson<DriveCredentials>(account.credentialsEnc);
      return new GoogleDriveProvider(
        creds,
        opts.googleClientId,
        opts.googleClientSecret,
        (next) => opts.onDriveTokensRefreshed?.(account.id, next),
      );
    }
    case 'DROPBOX': {
      const creds = decryptJson<DropboxCredentials>(account.credentialsEnc);
      const app = requireApp(opts.dropbox, 'Dropbox');
      return new DropboxProvider(creds, app.clientId, app.clientSecret, (next) =>
        opts.onOAuthTokensRefreshed?.(account.id, next),
      );
    }
    case 'ONEDRIVE': {
      const creds = decryptJson<OneDriveCredentials>(account.credentialsEnc);
      const app = requireApp(opts.microsoft, 'OneDrive');
      return new OneDriveProvider(creds, app.clientId, app.clientSecret, (next) =>
        opts.onOAuthTokensRefreshed?.(account.id, next),
      );
    }
    case 'R2':
    case 'S3': {
      const creds = decryptJson<S3Credentials>(account.credentialsEnc);
      return new S3Provider(creds);
    }
    default: {
      const exhaustive: never = account.provider;
      throw new Error(`Proveedor desconocido: ${String(exhaustive)}`);
    }
  }
}

/**
 * Cómo se conecta cada proveedor.
 *
 * - `oauth`: el usuario inicia sesión con su cuenta de siempre. Sin claves.
 * - `managed`: espacio que da la propia aplicación; no se conecta nada.
 * - `credentials`: exige claves de API. Es la vía avanzada, para quien tiene
 *   su propio bucket — un usuario normal no pasa por aquí.
 */
export type ConnectMode = 'oauth' | 'managed' | 'credentials';

export interface ProviderMeta {
  name: string;
  color: string;
  connectMode: ConnectMode;
  /** Frase corta para el botón de conectar. */
  tagline: string;
}

export const PROVIDER_META: Record<ProviderIdValue, ProviderMeta> = {
  GDRIVE: {
    name: 'Google Drive',
    color: '#1a73e8',
    connectMode: 'oauth',
    tagline: 'Inicia sesión con tu cuenta de Google',
  },
  DROPBOX: {
    name: 'Dropbox',
    color: '#0061ff',
    connectMode: 'oauth',
    tagline: 'Inicia sesión con tu cuenta de Dropbox',
  },
  ONEDRIVE: {
    name: 'OneDrive',
    color: '#0078d4',
    connectMode: 'oauth',
    tagline: 'Inicia sesión con tu cuenta de Microsoft',
  },
  R2: {
    name: 'Cloudflare R2',
    color: '#f6821f',
    connectMode: 'credentials',
    tagline: 'Tu propio bucket, con claves de API',
  },
  S3: {
    name: 'Amazon S3',
    color: '#569a31',
    connectMode: 'credentials',
    tagline: 'Tu propio bucket, con claves de API',
  },
};

/** Proveedores que un usuario normal puede conectar sin credenciales técnicas. */
export const OAUTH_PROVIDERS = (['GDRIVE', 'DROPBOX', 'ONEDRIVE'] as const);
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}
