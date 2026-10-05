// Своя база на каждый файл тестов: случайное имя, миграции от homecrm_owner, пулы всех ролей.
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDatabase, DB_ROLES } from '../bootstrap.ts';
import { runMigrations } from '../migrate.ts';

export interface TestDatabase {
  name: string;
  /** Суперпользователь: обходит RLS, нужен для вымышленных данных и проверки каталога. */
  admin: pg.Pool;
  owner: pg.Pool;
  app: pg.Pool;
  worker: pg.Pool;
  auth: pg.Pool;
  /** Пул заданного размера для роли — например, из одного соединения. */
  pool(role: keyof typeof DB_ROLES, max: number): pg.Pool;
  drop(): Promise<void>;
}

export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `homecrm_test_${randomBytes(6).toString('hex')}`;
  await withClient(adminUrl, (client) => createDatabase(client, name));

  const urlFor = (user?: string): string => {
    const url = new URL(adminUrl);
    if (user !== undefined) {
      url.username = user;
      url.password = '';
    }
    url.pathname = `/${name}`;
    return url.toString();
  };
  const pools: pg.Pool[] = [];
  const open = (user: string | undefined, max: number): pg.Pool => {
    const created = new pg.Pool({ connectionString: urlFor(user), max });
    pools.push(created);
    return created;
  };

  // Файлы тестов идут параллельно, а у сервера по умолчанию 100 соединений: пулы небольшие.
  const owner = open(DB_ROLES.owner, 1);
  await runMigrations(owner);

  return {
    name,
    admin: open(undefined, 2),
    owner,
    app: open(DB_ROLES.app, 8),
    worker: open(DB_ROLES.worker, 1),
    auth: open(DB_ROLES.auth, 8),
    pool: (role, max) => open(DB_ROLES[role], max),
    async drop() {
      await Promise.all(pools.map((created) => created.end()));
      await withClient(adminUrl, (client) => client.query(`DROP DATABASE ${name} WITH (FORCE)`));
    },
  };
}

async function withClient<T>(url: string, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
