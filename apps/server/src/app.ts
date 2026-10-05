import { type FastifyInstance, fastify } from 'fastify';
import { type AuthModule, authRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';

export interface AppDependencies {
  /** Вход и учётные записи (ADR-0005). Пока подключается только в тестах: в main.ts — вместе с базой в R0.1. */
  auth?: AuthModule;
}

export function buildApp(
  config: Pick<Config, 'LOG_LEVEL' | 'APP_VERSION'>,
  dependencies: AppDependencies = {},
): FastifyInstance {
  const app = fastify({ logger: { level: config.LOG_LEVEL } });
  const startedAt = Date.now();

  // Позже сюда добавятся база, пульс обработчика, возраст копии и ошибки push (план, раздел 7.3).
  app.get('/health', async () => ({
    status: 'ok',
    version: config.APP_VERSION,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  }));

  const { auth } = dependencies;
  if (auth !== undefined) void app.register(authRoutes, auth);

  return app;
}
