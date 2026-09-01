import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { s3AccountInputSchema } from '@imvoces/contracts';
import { prisma } from '@imvoces/db';
import { encryptJson, S3Provider, GoogleDriveProvider } from '@imvoces/providers';
import { env } from '../env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { buildProvider, ownedAccount, toAccountView } from '../lib/accounts.js';

/**
 * Scopes de Drive. Se arranca con `drive.file` (solo lo que la app crea o el
 * usuario elige) porque los scopes amplios son *restricted* y exigen revisión
 * de seguridad de Google antes de publicar.
 */
const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

function oauthClient() {
  return new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireUser);

  app.get('/accounts', async (req) => {
    const accounts = await prisma.storageAccount.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'asc' },
    });
    return { accounts: accounts.map(toAccountView) };
  });

  /** Inicia el consentimiento OAuth de Drive. El `state` se guarda en BD (anti-CSRF). */
  app.post('/accounts/gdrive/connect', async (req) => {
    const state = randomBytes(24).toString('base64url');
    await prisma.oAuthState.create({
      data: {
        state,
        userId: req.userId,
        provider: 'GDRIVE',
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const authUrl = oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // fuerza refresh_token también en reconexiones
      scope: DRIVE_SCOPES,
      state,
      include_granted_scopes: true,
    });
    return { authUrl, state };
  });

  /** Alta de una cuenta S3-compatible (R2). Se validan las credenciales antes de guardarlas. */
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

    const account = await prisma.storageAccount.upsert({
      where: {
        userId_provider_externalId: {
          userId: req.userId,
          provider: input.provider,
          externalId: input.bucket,
        },
      },
      create: {
        userId: req.userId,
        provider: input.provider,
        label: input.label,
        externalId: input.bucket,
        credentialsEnc: encryptJson(creds),
      },
      update: { label: input.label, credentialsEnc: encryptJson(creds), status: 'ACTIVE', lastError: null },
    });
    await audit(req.userId, 'account.connect', 'ok', { provider: input.provider }, req.ip);
    return toAccountView(account);
  });

  app.delete('/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    await ownedAccount(req.userId, id);
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
 * El callback de OAuth llega como redirección del navegador desde Google, sin
 * cabecera Authorization, así que vive fuera del scope autenticado: la identidad
 * la aporta el `state` de un solo uso guardado en BD.
 */
export async function oauthCallbackRoutes(app: FastifyInstance) {
  /** Callback del consentimiento. Redirige de vuelta a la web con el resultado. */
  app.get('/accounts/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const fail = (reason: string) =>
      reply.redirect(`${env.WEB_PUBLIC_URL}/accounts?connected=error&reason=${encodeURIComponent(reason)}`);

    if (query.error) return fail(query.error);
    if (!query.code || !query.state) return fail('faltan code/state');

    const pending = await prisma.oAuthState.findUnique({ where: { state: query.state } });
    if (!pending || pending.expiresAt < new Date()) return fail('state inválido o expirado');
    await prisma.oAuthState.delete({ where: { state: query.state } }).catch(() => undefined);

    const client = oauthClient();
    const { tokens } = await client.getToken(query.code);
    if (!tokens.refresh_token) return fail('Google no devolvió refresh_token');

    const creds = {
      accessToken: tokens.access_token ?? undefined,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ?? undefined,
      scopes: DRIVE_SCOPES,
    };
    const probe = new GoogleDriveProvider(creds, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
    const identity = await probe.identify();
    const quota = await probe.quota().catch(() => ({ used: null, total: null }));

    await prisma.storageAccount.upsert({
      where: {
        userId_provider_externalId: {
          userId: pending.userId,
          provider: 'GDRIVE',
          externalId: identity.externalId,
        },
      },
      create: {
        userId: pending.userId,
        provider: 'GDRIVE',
        label: identity.label,
        externalId: identity.externalId,
        credentialsEnc: encryptJson(creds),
        scopes: DRIVE_SCOPES,
        quotaUsed: quota.used == null ? null : BigInt(quota.used),
        quotaTotal: quota.total == null ? null : BigInt(quota.total),
      },
      update: {
        credentialsEnc: encryptJson(creds),
        status: 'ACTIVE',
        lastError: null,
        quotaUsed: quota.used == null ? null : BigInt(quota.used),
        quotaTotal: quota.total == null ? null : BigInt(quota.total),
      },
    });
    await audit(pending.userId, 'account.connect', 'ok', { provider: 'GDRIVE' }, req.ip);
    return reply.redirect(`${env.WEB_PUBLIC_URL}/accounts?connected=gdrive`);
  });
}
