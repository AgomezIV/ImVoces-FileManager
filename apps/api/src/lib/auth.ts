import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '@imvoces/db';
import { env, googleAudiences } from '../env.js';
import { unauthorized } from './errors.js';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export interface AccessClaims {
  sub: string;
  sid: string;
}

export async function signAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setIssuer('imvoces-api')
    .setAudience('imvoces-clients')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: 'imvoces-api',
      audience: 'imvoces-clients',
    });
    if (!payload.sub || typeof payload.sid !== 'string') throw new Error('claims incompletos');
    return { sub: payload.sub, sid: payload.sid };
  } catch {
    throw unauthorized('Token de acceso inválido o expirado');
  }
}

/**
 * Valida el idToken contra las claves públicas de Google.
 * Es la única puerta de entrada de identidad: nunca se confía en un email del cliente.
 */
export async function verifyGoogleIdToken(idToken: string) {
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: googleAudiences });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email) throw new Error('payload incompleto');
    if (payload.email_verified === false) throw new Error('email no verificado');
    return {
      sub: payload.sub,
      email: payload.email,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
    };
  } catch (err) {
    throw unauthorized(`Google idToken inválido: ${(err as Error).message}`);
  }
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Crea una sesión y devuelve el refresh token en claro (solo se ve aquí). */
export async function createSession(userId: string, meta: { device?: string; ip?: string; userAgent?: string }) {
  const refreshToken = randomBytes(48).toString('base64url');
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashToken(refreshToken),
      device: meta.device ?? null,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return { session, refreshToken };
}

/**
 * Rota el refresh token: invalida el actual y emite uno nuevo.
 * Si el token no existe, está revocado o expiró, la sesión se rechaza.
 */
export async function rotateSession(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
  const current = await prisma.session.findUnique({
    where: { refreshTokenHash: hashToken(refreshToken) },
    include: { user: true },
  });
  if (!current || current.revokedAt || current.expiresAt < new Date()) {
    throw unauthorized('Sesión expirada, vuelve a iniciar sesión');
  }

  const next = randomBytes(48).toString('base64url');
  const updated = await prisma.session.update({
    where: { id: current.id },
    data: {
      refreshTokenHash: hashToken(next),
      ip: meta.ip ?? current.ip,
      userAgent: meta.userAgent ?? current.userAgent,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    },
  });
  return { session: updated, user: current.user, refreshToken: next };
}
