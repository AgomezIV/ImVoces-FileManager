import { prisma, type StorageAccount } from '@imvoces/db';
import { encryptJson, type S3Credentials } from '@imvoces/providers';
import { env, managedStorageReady } from '../env.js';

/**
 * Espacio de almacenamiento que da la propia aplicación.
 *
 * Un usuario normal no tiene un bucket ni claves de API. Para que igualmente
 * tenga un destino al que copiar desde Drive o Dropbox, el operador configura
 * UN bucket y cada persona recibe su carpeta dentro de él.
 *
 * El aislamiento lo garantiza `rootPrefix`: el driver S3 resuelve toda ruta por
 * debajo de `users/<userId>/` y `normalizePath` rechaza el salto de directorio,
 * así que una ruta manipulada no alcanza el espacio de otro. Está probado en
 * `packages/providers/src/s3-prefix.test.ts`.
 */
export const MANAGED_EXTERNAL_ID = 'imvoces-managed';

export function managedCredentials(userId: string): S3Credentials {
  return {
    provider: 'R2',
    endpoint: env.MANAGED_R2_ENDPOINT || undefined,
    region: env.MANAGED_R2_REGION,
    bucket: env.MANAGED_R2_BUCKET,
    accessKeyId: env.MANAGED_R2_ACCESS_KEY_ID,
    secretAccessKey: env.MANAGED_R2_SECRET_ACCESS_KEY,
    forcePathStyle: true,
    rootPrefix: `users/${userId}`,
  };
}

/**
 * Garantiza que el usuario tenga su espacio. Es idempotente: se puede llamar en
 * cada listado de cuentas sin crear duplicados.
 *
 * Devuelve null si el operador no lo ha configurado, y entonces la aplicación
 * simplemente no lo ofrece.
 */
export async function ensureManagedAccount(userId: string): Promise<StorageAccount | null> {
  if (!managedStorageReady) return null;

  const existing = await prisma.storageAccount.findUnique({
    where: {
      userId_provider_externalId: {
        userId,
        provider: 'R2',
        externalId: MANAGED_EXTERNAL_ID,
      },
    },
  });
  if (existing) {
    // Las claves del operador pueden haber rotado: se refrescan sin tocar nada más.
    return prisma.storageAccount.update({
      where: { id: existing.id },
      data: { credentialsEnc: encryptJson(managedCredentials(userId)), status: 'ACTIVE' },
    });
  }

  return prisma.storageAccount.create({
    data: {
      userId,
      provider: 'R2',
      label: env.MANAGED_STORAGE_LABEL,
      externalId: MANAGED_EXTERNAL_ID,
      credentialsEnc: encryptJson(managedCredentials(userId)),
    },
  });
}

/** El espacio gestionado no se desconecta: es parte de la cuenta. */
export function isManagedAccount(account: Pick<StorageAccount, 'externalId'>): boolean {
  return account.externalId === MANAGED_EXTERNAL_ID;
}
