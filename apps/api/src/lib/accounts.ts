import { prisma, type StorageAccount } from '@imvoces/db';
import {
  encryptJson, providerFor,
  type DriveCredentials, type OAuthCredentials, type StorageProvider,
} from '@imvoces/providers';
import { env, oauthApps } from '../env.js';
import { notFound } from './errors.js';

/**
 * Carga una cuenta comprobando que pertenece al usuario.
 *
 * Todo endpoint que toque un proveedor pasa por aquí: es lo que impide que un
 * usuario referencie el `accountId` de otro.
 */
export async function ownedAccount(userId: string, accountId: string): Promise<StorageAccount> {
  const account = await prisma.storageAccount.findFirst({ where: { id: accountId, userId } });
  if (!account) throw notFound(`Cuenta ${accountId} no encontrada`);
  return account;
}

export function buildProvider(account: Pick<StorageAccount, 'id' | 'provider' | 'credentialsEnc'>): StorageProvider {
  return providerFor(
    { id: account.id, provider: account.provider, credentialsEnc: account.credentialsEnc },
    {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      dropbox: oauthApps.dropbox,
      microsoft: oauthApps.microsoft,
      onDriveTokensRefreshed: persistDriveTokens,
      onOAuthTokensRefreshed: persistOAuthTokens,
    },
  );
}

/** Google refresca el access token por su cuenta; hay que volver a guardarlo cifrado. */
export async function persistDriveTokens(accountId: string, creds: DriveCredentials): Promise<void> {
  await prisma.storageAccount
    .update({
      where: { id: accountId },
      data: { credentialsEnc: encryptJson(creds), status: 'ACTIVE', lastError: null },
    })
    .catch(() => undefined);
}

/** Dropbox y OneDrive rotan tokens por su cuenta; hay que reguardarlos cifrados. */
export async function persistOAuthTokens(accountId: string, creds: OAuthCredentials): Promise<void> {
  await prisma.storageAccount
    .update({
      where: { id: accountId },
      data: { credentialsEnc: encryptJson(creds), status: 'ACTIVE', lastError: null },
    })
    .catch(() => undefined);
}

export async function providerForUser(userId: string, accountId: string): Promise<StorageProvider> {
  return buildProvider(await ownedAccount(userId, accountId));
}

/** Proyección pública: sin credenciales, con BigInt convertido a number. */
export function toAccountView(a: StorageAccount) {
  return {
    id: a.id,
    provider: a.provider,
    label: a.label,
    externalId: a.externalId,
    status: a.status,
    lastError: a.lastError,
    quotaUsed: a.quotaUsed == null ? null : Number(a.quotaUsed),
    quotaTotal: a.quotaTotal == null ? null : Number(a.quotaTotal),
    createdAt: a.createdAt.toISOString(),
  };
}
