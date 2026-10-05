import { type FastifyInstance, fastify } from 'fastify';
import type { Config } from './config.ts';

export function buildApp(config: Pick<Config, 'LOG_LEVEL' | 'APP_VERSION'>): FastifyInstance {
  const app = fastify({ logger: { level: config.LOG_LEVEL } });
  const startedAt = Date.now();

  // Позже сюда добавятся база, пульс обработчика, возраст копии и ошибки push (план, раздел 7.3).
  app.get('/health', async () => ({
    status: 'ok',
    version: config.APP_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  }));

  return app;
}
