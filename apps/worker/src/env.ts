import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CREDENTIALS_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TRANSFER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  TRANSFER_PART_SIZE_MB: z.coerce.number().int().min(5).max(128).default(16),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuración inválida del worker:\n${issues}`);
}
export const env = parsed.data;
