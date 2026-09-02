import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { s3AccountInputSchema } from '@imvoces/contracts';
import { prisma, type ProviderId } from '@imvoces/db';
import {
  encryptJson, isOAuthProvider, PROVIDER_META, S3Provider,
  GoogleDriveProvider, DropboxProvider, OneDriveProvider,
  DROPBOX_AUTH_URL, DROPBOX_TOKEN_URL, DROPBOX_SCOPES,
  MS_AUTH_URL, MS_TOKEN_URL, MS_SCOPES,
  type OAuthCredentials, type StorageProvider,
} from '@imvoces/providers';
import { env, managedStorageReady, oauthApps } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { buildProvider, ownedAccount, toAccountView } from '../lib/accounts.js';
import { ensureManagedAccount, isManagedAccount, MANAGED_EXTERNAL_ID } from '../lib/managed-storage.js';

/**
 * Scopes de Drive. Se arranca con `drive.file` (solo lo que la app crea o el
 * usuario elige) porque los scopes amplios son *restricted* y exigen revisión
 * de seguridad de Google antes de publicar.
 */
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

type OAuthProvider = 'GDRIVE' | 'DROPBOX' | 'ONEDRIVE';

/**
 * Todo lo que distingue a un proveedor OAuth de otro.
 *
 * Con esta tabla, conectar Dropbox u OneDrive es el mismo código que conectar
 * Drive: el usuario pulsa un botón, inicia sesión con su cuenta de siempre y
 * vuelve. En ningún momento ve —ni necesita— una clave de API.
 */
const OAUTH_CONFIG: Record<
  OAuthProvider,
  {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    app: () => { clientId: string; clientSecret: string };
    /** Parámetros extra que cada proveedor exige para devolver refresh token. */
    extraAuthParams: Record<string, string>;
  }
> = {
  GDRIVE: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: DRIVE_SCOPES,
    app: () => ({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
    // `select_account` deja elegir CUÁL cuenta conectar: sin él Google reutiliza
    // la sesión abierta y sería imposible añadir un segundo Drive.
    // `consent` fuerza refresh_token también al reconectar una cuenta ya vista.
    extraAuthParams: {
      access_type: 'offline',
      prompt: 'select_account consent',
      include_granted_scopes: 'true',
    },
  },
  DROPBOX: {
    authUrl: DROPBOX_AUTH_URL,
    tokenUrl: DROPBOX_TOKEN_URL,
    scopes: DROPBOX_SCOPES,
    app: () => oauthApps.dropbox,
    // Sin `offline` Dropbox emite un token de 4 horas y sin refresh.
    extraAuthParams: { token_access_type: 'offline' },
  },
  ONEDRIVE: {
    authUrl: MS_AUTH_URL,
    tokenUrl: MS_TOKEN_URL,
    scopes: MS_SCOPES,
    app: () => oauthApps.microsoft,
    // Igual que en Google: sin `select_account` no se puede añadir un segundo OneDrive.
    extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
  },
};

const redirectUri = () => env.GOOGLE_OAUTH_REDIRECT_URI;

function appFor(provider: OAuthProvider) {
  const app = OAUTH_CONFIG[provider].app();
  if (!app.clientId || !app.clientSecret) {
    throw badRequest(
      `${PROVIDER_META[provider].name} no está disponible: el servidor no tiene configurada su aplicación OAuth.`,
    );
  }
  return app;
}

/** Proveedores que el servidor puede ofrecer ahora mismo. */
function availableProviders() {
  return (Object.keys(OAUTH_CONFIG) as OAuthProvider[])
    .filter((p) => {
      const app = OAUTH_CONFIG[p].app();
      return !!app.clientId && !!app.clientSecret;
    })
    .map((p) => ({ id: p, ...PROVIDER_META[p] }));
}

/** Canjea el `code` del callback por tokens. Igual para los tres proveedores. */
async function exchangeCode(provider: OAuthProvider, code: string): Promise<OAuthCredentials> {
  const config = OAUTH_CONFIG[provider];
  const app = appFor(provider);

  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw badRequest(`El proveedor rechazó el código (${res.status}): ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.refresh_token) {
    throw badRequest(
      'El proveedor no devolvió refresh token. Revoca el acceso de la aplicación en tu cuenta y vuelve a conectar.',
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    scopes: config.scopes,
  };
}

/** Instancia efímera para preguntar al proveedor quién es el usuario recién conectado. */
function probeFor(provider: OAuthProvider, creds: OAuthCredentials): StorageProvider {
  const app = appFor(provider);
  switch (provider) {
    case 'GDRIVE':
      return new GoogleDriveProvider(
        { refreshToken: creds.refreshToken, accessToken: creds.accessToken, expiryDate: creds.expiresAt },
        app.clientId,
        app.clientSecret,
      );
    case 'DROPBOX':
      return new DropboxProvider(creds, app.clientId, app.clientSecret);
    case 'ONEDRIVE':
      return new OneDriveProvider(creds, app.clientId, app.clientSecret);
  }
}

/** Drive guarda los tokens con otra forma; el resto comparte `OAuthCredentials`. */
function credentialsToStore(provider: OAuthProvider, creds: OAuthCredentials): unknown {
  if (provider === 'GDRIVE') {
    return {
      accessToken: creds.accessToken,
      refreshToken: creds.refreshToken,
      expiryDate: creds.expiresAt,
      scopes: creds.scopes,
    };
  }
  return creds;
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireUser);

  /**
   * Cuentas del usuario. De paso se asegura su espacio gestionado, así que
   * alguien que acaba de registrarse ya tiene un destino donde copiar.
   */
  app.get('/accounts', async (req) => {
    await ensureManagedAccount(req.userId);
    const accounts = await prisma.storageAccount.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      accounts: accounts.map((a) => ({
        ...toAccountView(a),
        managed: isManagedAccount(a),
      })),
      /** Lo que la UI puede ofrecer: se pinta sola a partir de esto. */
      available: availableProviders(),
      managedStorage: managedStorageReady,
    };
  });

  /**
   * Inicia el consentimiento. Devuelve la URL a la que mandar al usuario;
   * lo único que verá es la pantalla de login de su proveedor.
   */
  app.post('/accounts/:provider/connect', async (req) => {
    const { provider } = req.params as { provider: string };
    const id = provider.toUpperCase();
    if (!isOAuthProvider(id)) throw badRequest(`Proveedor no conectable por OAuth: ${provider}`);

    const config = OAUTH_CONFIG[id];
    const oauthApp = appFor(id);

    const state = randomBytes(24).toString('base64url');
    await prisma.oAuthState.create({
      data: {
        state,
        userId: req.userId,
        provider: id as ProviderId,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });

    const params = new URLSearchParams({
      client_id: oauthApp.clientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      ...config.extraAuthParams,
    });
    return { authUrl: `${config.authUrl}?${params.toString()}`, state };
  });

  /** Alta de una cuenta S3-compatible. Vía avanzada: exige claves propias. */
  app.post('/accounts/s3', async (req) => {
    const parsed = s3AccountInputSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Credenciales inválidas', parsed.error.issues);
    const input = parsed.data;

    const creds = {
      provider: input.provider,
      endpoint: input.endpoint,
      region: input.region,
      bucket: input.bucket,
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
      forcePathStyle: input.forcePathStyle,
    };
    const probe = new S3Provider(creds);
    // Un listado de un elemento confirma credenciales, endpoint y permisos de una vez.
    await probe.list({ path: '/' }, { pageSize: 1 });

    /**
     * Identidad de la cuenta dentro del proveedor.
     *
     * El bucket solo no basta: dos cuentas distintas de Cloudflare pueden tener
     * un bucket con el mismo nombre, y se pisarían al vincular la segunda. El
     * endpoint (o la región, en S3 de AWS) los separa.
     */
    const host = input.endpoint ? new URL(input.endpoint).host : input.region;
    const externalId = `${host}/${input.bucket}`;

    if (externalId === MANAGED_EXTERNAL_ID || input.bucket === MANAGED_EXTERNAL_ID) {
      throw badRequest('Ese identificador está reservado por la aplicación.');
    }

    const account = await prisma.storageAccount.upsert({
      where: {
        userId_provider_externalId: {
          userId: req.userId,
          provider: input.provider,
          externalId,
        },
      },
      create: {
        userId: req.userId,
        provider: input.provider,
        label: input.label,
        externalId,
        credentialsEnc: encryptJson(creds),
      },
      update: { label: input.label, credentialsEnc: encryptJson(creds), status: 'ACTIVE', lastError: null },
    });
    await audit(req.userId, 'account.connect', 'ok', { provider: input.provider }, req.ip);
    return toAccountView(account);
  });

  app.delete('/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const account = await ownedAccount(req.userId, id);
    if (isManagedAccount(account)) {
      throw badRequest('El espacio de la aplicación no se puede desconectar.');
    }

    // Un borrado con transferencias históricas rompería la FK: se desactiva en su lugar.
    const referenced = await prisma.transferItem.count({
      where: { OR: [{ srcAccountId: id }, { destAccountId: id }] },
    });
    if (referenced > 0) {
      await prisma.storageAccount.update({ where: { id }, data: { status: 'DISABLED' } });
    } else {
      await prisma.storageAccount.delete({ where: { id } });
    }
    await audit(req.userId, 'account.disconnect', 'ok', { accountId: id }, req.ip);
    return { ok: true, disabled: referenced > 0 };
  });

  /** Refresca la cuota mostrada en el selector de cuentas. */
  app.post('/accounts/:id/refresh', async (req) => {
    const { id } = req.params as { id: string };
    const account = await ownedAccount(req.userId, id);
    const provider = buildProvider(account);
    if (!provider.quota) throw notFound('Este proveedor no informa de cuota');
    const quota = await provider.quota();
    const updated = await prisma.storageAccount.update({
      where: { id },
      data: {
        quotaUsed: quota.used == null ? null : BigInt(quota.used),
        quotaTotal: quota.total == null ? null : BigInt(quota.total),
      },
    });
    return toAccountView(updated);
  });
}

/**
 * El callback de OAuth llega como redirección del navegador desde el proveedor,
 * sin cabecera Authorization, así que vive fuera del scope autenticado: la
 * identidad la aporta el `state` de un solo uso guardado en BD.
 */
export async function oauthCallbackRoutes(app: FastifyInstance) {
  app.get('/accounts/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const fail = (reason: string) =>
      reply.redirect(`${env.WEB_PUBLIC_URL}/accounts?connected=error&reason=${encodeURIComponent(reason)}`);

    if (query.error) return fail(query.error);
    if (!query.code || !query.state) return fail('faltan code/state');

    const pending = await prisma.oAuthState.findUnique({ where: { state: query.state } });
    if (!pending || pending.expiresAt < new Date()) return fail('state inválido o expirado');
    await prisma.oAuthState.delete({ where: { state: query.state } }).catch(() => undefined);

    const provider = pending.provider as OAuthProvider;
    if (!isOAuthProvider(provider)) return fail(`proveedor no soportado: ${provider}`);

    try {
      const creds = await exchangeCode(provider, query.code);
      const probe = probeFor(provider, creds);
      const identity = await probe.identify();
      const quota = await probe.quota?.().catch(() => ({ used: null, total: null }));

      await prisma.storageAccount.upsert({
        where: {
          userId_provider_externalId: {
            userId: pending.userId,
            provider: provider as ProviderId,
            externalId: identity.externalId,
          },
        },
        create: {
          userId: pending.userId,
          provider: provider as ProviderId,
          label: identity.label,
          externalId: identity.externalId,
          credentialsEnc: encryptJson(credentialsToStore(provider, creds)),
          scopes: creds.scopes ?? [],
          quotaUsed: quota?.used == null ? null : BigInt(quota.used),
          quotaTotal: quota?.total == null ? null : BigInt(quota.total),
        },
        update: {
          credentialsEnc: encryptJson(credentialsToStore(provider, creds)),
          status: 'ACTIVE',
          lastError: null,
          quotaUsed: quota?.used == null ? null : BigInt(quota.used),
          quotaTotal: quota?.total == null ? null : BigInt(quota.total),
        },
      });
      await audit(pending.userId, 'account.connect', 'ok', { provider }, req.ip);
      return reply.redirect(`${env.WEB_PUBLIC_URL}/accounts?connected=${provider.toLowerCase()}`);
    } catch (err) {
      return fail((err as Error).message);
    }
  });
}
