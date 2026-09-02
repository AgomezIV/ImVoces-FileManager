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

  // Dropbox y Microsoft: se configuran una vez en el servidor. El usuario final
  // solo pulsa "Conectar" e inicia sesion con su cuenta de siempre.
  DROPBOX_CLIENT_ID: z.string().default(''),
  DROPBOX_CLIENT_SECRET: z.string().default(''),
  MICROSOFT_CLIENT_ID: z.string().default(''),
  MICROSOFT_CLIENT_SECRET: z.string().default(''),

  // Espacio de almacenamiento que ofrece la propia aplicacion. Un bucket del
  // operador, con una carpeta por usuario. Asi alguien que solo tiene Google
  // Drive ya tiene un destino al que copiar, sin claves ni configuracion.
  MANAGED_STORAGE_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  MANAGED_STORAGE_LABEL: z.string().default('Mi espacio ImVoces'),
  MANAGED_R2_ENDPOINT: z.string().default(''),
  MANAGED_R2_BUCKET: z.string().default(''),
  MANAGED_R2_REGION: z.string().default('auto'),
  MANAGED_R2_ACCESS_KEY_ID: z.string().default(''),
  MANAGED_R2_SECRET_ACCESS_KEY: z.string().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuración inválida (revisa tu .env):\n${issues}`);
}

export const env = parsed.data;

export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

/** Configuracion de las apps OAuth que el operador registra una sola vez. */
export const oauthApps = {
  dropbox: { clientId: env.DROPBOX_CLIENT_ID, clientSecret: env.DROPBOX_CLIENT_SECRET },
  microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET },
};

/** El espacio gestionado solo se ofrece si esta completo: sin medias tintas. */
export const managedStorageReady =
  env.MANAGED_STORAGE_ENABLED &&
  !!env.MANAGED_R2_BUCKET &&
  !!env.MANAGED_R2_ACCESS_KEY_ID &&
  !!env.MANAGED_R2_SECRET_ACCESS_KEY;

/** Audiencias aceptadas al validar el idToken: el client web más los de Android. */
export const googleAudiences = [
  env.GOOGLE_CLIENT_ID,
  ...env.GOOGLE_ALLOWED_AUDIENCES.split(',').map((s) => s.trim()).filter(Boolean),
];
