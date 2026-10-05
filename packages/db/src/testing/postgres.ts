// Одноразовый сервер PostgreSQL 18 на прогон тестов.
// - В CI адрес служебного контейнера приходит в HOMECRM_TEST_PG_ADMIN_URL (ci.yml).
// - Локально поднимается compose-проект homecrm-test-<ветка> из compose.test.yaml,
//   а после прогона удаляется вместе с данными.
// Один прогон тестов базы на ветку одновременно: следующий прогон начинает с уборки остатков прошлого.
// Пакеты, которым нужна своя база (db, server), получают каждый свой compose-проект с суффиксом
// имени пакета: общий проект сносил бы базу одного пакета во время прогона другого.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const COMPOSE_FILE = fileURLToPath(new URL('../../compose.test.yaml', import.meta.url));

export interface TestPostgres {
  /** Подключение суперпользователя к служебной базе postgres. */
  adminUrl: string;
  stop(): Promise<void>;
}

async function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`${command} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, {
      cause: error,
    });
  }
}

async function ensureDocker(): Promise<void> {
  try {
    await run('docker', ['info', '--format', '{{.ServerVersion}}'], 20_000);
  } catch (error) {
    throw new Error(
      'Docker недоступен, а тестам пакета db нужна PostgreSQL 18 в Docker (матрица доступа). ' +
        'Запустите Docker Desktop и повторите. Если сервер уже есть, задайте HOMECRM_TEST_PG_ADMIN_URL.',
      { cause: error },
    );
  }
}

/** Имя compose-проекта по ветке: homecrm-test-spike-0-4-rls; для другого пакета — с суффиксом -server. */
async function projectName(scope?: string): Promise<string> {
  let branch = 'local';
  try {
    branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 10_000)).trim();
  } catch {
    // Вне git (архив, образ) хватает общего имени.
  }
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `homecrm-test-${slug || 'local'}${scope ? `-${scope}` : ''}`;
}

export async function startPostgres(scope?: string): Promise<TestPostgres> {
  const external = process.env.HOMECRM_TEST_PG_ADMIN_URL;
  if (external) return { adminUrl: external, stop: async () => {} };

  await ensureDocker();
  const project = await projectName(scope);
  const compose = (args: string[], timeoutMs = 60_000) =>
    run('docker', ['compose', '-p', project, '-f', COMPOSE_FILE, ...args], timeoutMs);
  const down = async () => {
    await compose(['down', '--volumes', '--remove-orphans']);
  };

  await down();
  try {
    // Первый запуск скачивает образ postgres:18, поэтому ждём дольше.
    await compose(['up', '--detach', '--wait', '--wait-timeout', '120'], 600_000);
    const address = (await compose(['port', 'postgres', '5432'])).trim();
    const port = /:(\d+)$/.exec(address)?.[1];
    if (port === undefined) throw new Error(`Unexpected port mapping: ${address}`);
    return { adminUrl: `postgres://postgres@127.0.0.1:${port}/postgres`, stop: down };
  } catch (error) {
    // Контейнер не должен пережить неудачный запуск; исходная ошибка важнее ошибки уборки.
    await down().catch((cleanupError: unknown) => {
      console.error(`Не удалось удалить compose-проект ${project}:`, cleanupError);
    });
    throw error;
  }
}
