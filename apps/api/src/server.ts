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
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.query.access_token'],
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

  /**
   * Guard de sesión: exige un access token válido y expone `req.userId`.
   *
   * `EventSource` (el SSE del navegador) no permite fijar cabeceras, así que
   * en ESE endpoint —y solo ahí— se acepta el token por query. Es de solo
   * lectura, dura 15 minutos y el logger redacta la URL para que no acabe en
   * los registros.
   */
  app.decorate('requireUser', async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    let token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    // `EventSource`, `<img>` y `<video>` no permiten fijar cabeceras, así que en
    // esos dos endpoints —y solo ahí— se acepta el token por query. Los dos son
    // de solo lectura, el token dura 15 minutos, el logger redacta la URL y la
    // respuesta va con `Referrer-Policy: no-referrer`.
    const byQuery = req.method === 'GET' && (req.url.includes('/events') || req.url.includes('/fs/content'));
    if (!token && byQuery) {
      token = (req.query as { access_token?: string }).access_token;
    }
    if (!token) throw unauthorized('Falta cabecera Authorization');

    const claims = await verifyAccessToken(token);
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
