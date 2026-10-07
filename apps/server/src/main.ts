import {
  createAppDatabase,
  createAuthDatabase,
  createPool,
  createWorkerDatabase,
} from '@homecrm/db';
import { buildApp } from './app.ts';
import { scheduleCleanup } from './auth/cleanup.ts';
import { createAuthModule } from './auth/routes.ts';
import {
  configurationErrorMessage,
  loadAuthConfig,
  loadConfig,
  loadFilesConfig,
} from './config.ts';
import { initializeHouseTimeZones } from './deadlines/engine.ts';
import { scheduleFileCleanup } from './files/cleanup.ts';
import { readMasterKey } from './files/crypto.ts';
import type { FileServices } from './files/service.ts';
import { DirectoryStorage } from './files/storage.ts';

// Строки подключения и секрет входа — из файла окружения (--env-file). В журнал они не попадают:
// ошибка настройки называет только переменные.
let config: ReturnType<typeof loadConfig>;
let files: FileServices;
let authConfig: ReturnType<typeof loadAuthConfig>;
try {
  config = loadConfig();
  authConfig = loadAuthConfig();
  const filesConfig = loadFilesConfig();
  files = {
    storage: new DirectoryStorage(filesConfig.FILES_DIR),
    cipher: await readMasterKey(
      filesConfig.FILE_MASTER_KEY_FILE,
      filesConfig.FILE_MASTER_KEY_VERSION,
    ),
  };
} catch (error) {
  console.error(configurationErrorMessage(error));
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
  homeTimeZone: authConfig.HOME_TIME_ZONE,
});
const worker = createWorkerDatabase(workerPool);
await initializeHouseTimeZones(worker, authConfig.HOME_TIME_ZONE);
const app = buildApp(config, {
  auth,
  worker,
  files,
  checkDatabase: async () => {
    await workerPool.query('select 1');
  },
  ...(config.STATIC_DIR === undefined ? {} : { staticDir: config.STATIC_DIR }),
});
// Сообщения о сбое соединения не содержат строки подключения: pg пишет только причину.
poolErrors.push((error) => app.log.error({ message: error.message }, 'database pool error'));

const stopFiles = scheduleFileCleanup(worker, files.storage, app.log);
const stopCleanup = scheduleCleanup(worker, app.log);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    stopCleanup();
    stopFiles();
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
