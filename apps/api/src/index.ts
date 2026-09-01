import { buildServer } from './server.js';
import { env } from './env.js';

const app = await buildServer();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`ImVoces API escuchando en :${env.PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
