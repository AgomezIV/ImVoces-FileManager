import type { ProviderIdValue, StorageProvider } from './types.js';
import { decryptJson } from './crypto.js';
import { GoogleDriveProvider, type DriveCredentials } from './drivers/gdrive.js';
import { S3Provider, type S3Credentials } from './drivers/s3.js';

/** Fila mínima de `StorageAccount` que el registry necesita. */
export interface AccountRecord {
  id: string;
  provider: ProviderIdValue;
  credentialsEnc: string;
}

export interface RegistryOptions {
  googleClientId: string;
  googleClientSecret: string;
  /** Persiste los tokens de Drive cuando google-auth-library los refresca. */
  onDriveTokensRefreshed?: (accountId: string, creds: DriveCredentials) => Promise<void>;
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
    case 'R2':
    case 'S3': {
      const creds = decryptJson<S3Credentials>(account.credentialsEnc);
      return new S3Provider(creds);
    }
    case 'DROPBOX':
    case 'ONEDRIVE':
      throw new Error(`Proveedor aún no implementado: ${account.provider}`);
    default: {
      const exhaustive: never = account.provider;
      throw new Error(`Proveedor desconocido: ${String(exhaustive)}`);
    }
  }
}

/** Metadatos para pintar el selector de cuentas en web y móvil. */
export const PROVIDER_META: Record<ProviderIdValue, { name: string; color: string; connectMode: 'oauth' | 'credentials' }> = {
  GDRIVE: { name: 'Google Drive', color: '#1a73e8', connectMode: 'oauth' },
  R2: { name: 'Cloudflare R2', color: '#f6821f', connectMode: 'credentials' },
  S3: { name: 'Amazon S3', color: '#569a31', connectMode: 'credentials' },
  DROPBOX: { name: 'Dropbox', color: '#0061ff', connectMode: 'oauth' },
  ONEDRIVE: { name: 'OneDrive', color: '#0078d4', connectMode: 'oauth' },
};
