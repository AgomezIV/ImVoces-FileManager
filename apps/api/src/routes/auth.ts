import type { FastifyInstance } from 'fastify';
import { googleLoginRequestSchema } from '@imvoces/contracts';
import { prisma } from '@imvoces/db';
import { env } from '../env.js';
import { createSession, rotateSession, signAccessToken, verifyGoogleIdToken, hashToken } from '../lib/auth.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const REFRESH_COOKIE = 'imv_refresh';

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  };
}

export async function authRoutes(app: FastifyInstance) {
  /**
   * Canjea un idToken de Google Sign-In por una sesión propia.
   * Web recibe el refresh token en cookie HttpOnly; móvil lo recibe en el cuerpo
   * (lo guarda en flutter_secure_storage) porque no tiene almacén de cookies fiable.
   */
  app.post('/auth/google', async (req, reply) => {
    const parsed = googleLoginRequestSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Cuerpo inválido', parsed.error.issues);

    const profile = await verifyGoogleIdToken(parsed.data.idToken);
    const user = await prisma.user.upsert({
      where: { googleSub: profile.sub },
      create: {
        googleSub: profile.sub,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
      update: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
    });

    const { session, refreshToken } = await createSession(user.id, {
      device: parsed.data.device,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const accessToken = await signAccessToken(user.id, session.id);
    await audit(user.id, 'auth.login', 'ok', { device: parsed.data.device }, req.ip);

    const isMobile = parsed.data.device !== undefined;
    if (!isMobile) reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());

    return {
      accessToken,
      expiresIn: 900,
      refreshToken: isMobile ? refreshToken : undefined,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    };
  });

  app.post('/auth/refresh', async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    const token = body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (!token) throw unauthorized('Falta refresh token');

    const { session, user, refreshToken } = await rotateSession(token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    const accessToken = await signAccessToken(user.id, session.id);

    if (!body.refreshToken) reply.setCookie(REFRESH_COOKIE, refreshToken, cookieOptions());

    return {
      accessToken,
      expiresIn: 900,
      refreshToken: body.refreshToken ? refreshToken : undefined,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    };
  });

  app.post('/auth/logout', async (req, reply) => {
    const body = (req.body ?? {}) as { refreshToken?: string };
    const token = body.refreshToken ?? req.cookies[REFRESH_COOKIE];
    if (token) {
      await prisma.session
        .updateMany({
          where: { refreshTokenHash: hashToken(token), revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch(() => undefined);
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: app.requireUser }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
  });
}
