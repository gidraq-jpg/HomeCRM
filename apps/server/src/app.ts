import type { Database } from '@homecrm/db';
import { type FastifyInstance, fastify } from 'fastify';
import { type AuthModule, authRoutes } from './auth/routes.ts';
import type { Config } from './config.ts';
import { householdRoutes } from './household/routes.ts';
import { serializeRequest } from './logging.ts';
import { notesRoutes } from './notes/routes.ts';
import { createStaticHandler } from './static.ts';

export interface AppDependencies {
  /** Вход и учётные записи (ADR-0005). Пока подключается только в тестах: в main.ts — вместе с базой в R0.1. */
  auth?: AuthModule;
  /** Обработчик передачи ответственности после ухода участника. */
  worker?: Database;
  /** Куда писать журнал вместо стандартного вывода: нужно тестам, которые читают журнал. */
  logStream?: { write(line: string): void };
  /** Проверка базы для /health: выбрасывает ошибку, если база не отвечает. Без неё /health базу не проверяет. */
  checkDatabase?: () => Promise<void>;
  /** Папка собранного клиента: если задана, сервер отдаёт её файлы и index.html для маршрутов приложения. */
  staticDir?: string;
}

/** Сколько ждать ответа базы в /health: дольше — значит, она не отвечает. */
const HEALTH_DB_TIMEOUT_MS = 3000;

export function buildApp(
  config: Pick<Config, 'LOG_LEVEL' | 'APP_VERSION'> & Partial<Pick<Config, 'TRUST_PROXY'>>,
  dependencies: AppDependencies = {},
): FastifyInstance {
  const app = fastify({
    // Адрес клиента для ограничения попыток и журнала входов (AUTH-8) берётся из X-Forwarded-For,
    // только если сервер за доверенным прокси; по умолчанию — адрес соединения (TRUST_PROXY, config.ts).
    trustProxy: config.TRUST_PROXY ?? false,
    logger: {
      level: config.LOG_LEVEL,
      serializers: { req: serializeRequest },
      ...(dependencies.logStream ? { stream: dependencies.logStream } : {}),
    },
  });
  const startedAt = Date.now();

  // Личные ответы API нельзя хранить в браузере или прокси, включая ошибки и неизвестные пути.
  app.addHook('onSend', async (request, reply, payload) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/api' || path.startsWith('/api/')) void reply.header('cache-control', 'no-store');
    return payload;
  });

  // Стандартный ответ Fastify пишет в журнал Route GET:<адрес> not found с полным адресом, а в адресе
  // ссылок-приглашений и сброса пароля — токен. Свой обработчик журнал адресом не засоряет.
  const serveStatic =
    dependencies.staticDir === undefined ? undefined : createStaticHandler(dependencies.staticDir);
  app.setNotFoundHandler(async (request, reply) => {
    if (serveStatic !== undefined && (await serveStatic(request, reply))) return reply;
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found' });
  });

  // Позже сюда добавятся пульс обработчика, возраст копии и ошибки push (план, раздел 7.3).
  // Ошибку базы в ответ не выводим: строка подключения и текст ошибки могут содержать секреты.
  app.get('/health', async (_request, reply) => {
    const base = {
      version: config.APP_VERSION,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    };
    const { checkDatabase } = dependencies;
    if (checkDatabase === undefined) return { status: 'ok', ...base };
    try {
      await Promise.race([
        checkDatabase(),
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('timeout')), HEALTH_DB_TIMEOUT_MS).unref(),
        ),
      ]);
      return { status: 'ok', database: 'ok', ...base };
    } catch (error) {
      app.log.error(
        { message: error instanceof Error ? error.message : 'unknown' },
        'health: database check failed',
      );
      return reply.code(503).send({ status: 'degraded', database: 'down', ...base });
    }
  });

  const { auth } = dependencies;
  if (auth !== undefined) {
    void app.register(authRoutes, auth);
    void app.register(notesRoutes, auth);
    void app.register(householdRoutes, {
      ...auth,
      ...(dependencies.worker ? { worker: dependencies.worker } : {}),
    });
  }

  return app;
}
