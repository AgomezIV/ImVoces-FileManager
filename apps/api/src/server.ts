import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { ProviderError } from '@imvoces/providers';
import { corsOrigins, env } from './env.js';
import { HttpError, unauthorized } from './lib/errors.js';
import { verifyAccessToken } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { accountRoutes, oauthCallbackRoutes } from './routes/accounts.js';
import { fsRoutes } from './routes/fs.js';
import { transferRoutes } from './routes/transfers.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId: string;
    sessionId: string;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'debug' : 'info',
      // Nunca volcar cabeceras: llevan el Bearer y la cookie de refresh.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, {
    // La app móvil no manda Origin; se acepta la petición sin él.
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.userId ?? req.ip,
  });

  /** Guard de sesión: exige un access token válido y expone `req.userId`. */
  app.decorate('requireUser', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Falta cabecera Authorization');
    const claims = await verifyAccessToken(header.slice(7));
    req.userId = claims.sub;
    req.sessionId = claims.sid;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err instanceof ProviderError) {
      // 502: el fallo es del proveedor remoto, no de nuestra API.
      return reply.status(err.status && err.status < 500 ? err.status : 502).send({
        error: { code: err.code, message: err.message },
      });
    }
    req.log.error({ err }, 'error no controlado');
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Error interno del servidor' },
    });
  });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(oauthCallbackRoutes);
  await app.register(accountRoutes);
  await app.register(fsRoutes);
  await app.register(transferRoutes);

  return app;
}
