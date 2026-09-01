import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  CREDENTIALS_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_ALLOWED_AUDIENCES: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().default('http://localhost:4000/accounts/callback'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuración inválida (revisa tu .env):\n${issues}`);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

/** Audiencias aceptadas al validar el idToken: el client web más los de Android. */
export const googleAudiences = [
  env.GOOGLE_CLIENT_ID,
  ...env.GOOGLE_ALLOWED_AUDIENCES.split(',').map((s) => s.trim()).filter(Boolean),
];
