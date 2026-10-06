import {
  createAppDatabase,
  createAuthDatabase,
  createPool,
  createWorkerDatabase,
} from '@homecrm/db';
import { buildApp } from './app.ts';
import { scheduleCleanup } from './auth/cleanup.ts';
import { createAuthModule } from './auth/routes.ts';
import { ConfigError, loadAuthConfig, loadConfig } from './config.ts';

// Строки подключения и секрет входа — из файла окружения (--env-file). В журнал они не попадают:
// ошибка настройки называет только переменные.
let config: ReturnType<typeof loadConfig>;
let authConfig: ReturnType<typeof loadAuthConfig>;
try {
  config = loadConfig();
  authConfig = loadAuthConfig();
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : 'Invalid configuration');
  process.exit(1);
}

const poolErrors: Array<(error: Error) => void> = [];
const onPoolError = (error: Error): void => {
  for (const handler of poolErrors) handler(error);
};
const appPool = createPool(authConfig.DATABASE_URL_APP, { onError: onPoolError });
const authPool = createPool(authConfig.DATABASE_URL_AUTH, { onError: onPoolError });
const workerPool = createPool(authConfig.DATABASE_URL_WORKER, { max: 2, onError: onPoolError });

const auth = createAuthModule({
  db: createAuthDatabase(authPool),
  appDb: createAppDatabase(appPool),
  secret: authConfig.BETTER_AUTH_SECRET,
  baseURL: authConfig.BASE_URL,
  trustedOrigins: authConfig.TRUSTED_ORIGINS,
});
const app = buildApp(config, { auth });
// Сообщения о сбое соединения не содержат строки подключения: pg пишет только причину.
poolErrors.push((error) => app.log.error({ message: error.message }, 'database pool error'));

const stopCleanup = scheduleCleanup(createWorkerDatabase(workerPool), app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    stopCleanup();
    app
      .close()
      .then(() => Promise.all([appPool.end(), authPool.end(), workerPool.end()]))
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error(error, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

await app.listen({ host: config.HOST, port: config.PORT });
