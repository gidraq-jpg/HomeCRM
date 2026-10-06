// База для эксплуатации: ожидание, роли и пароли, число строк по таблицам, состояние миграций.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDatabase, createPool, createRoles, DB_ROLES, MIGRATIONS_DIR } from '@homecrm/db';
import { adminUrl, type OpsEnv } from './env.ts';
import type { Log } from './process.ts';

type Pool = ReturnType<typeof createPool>;
export interface Queryable {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Подключение суперпользователем; ждёт, пока база поднимется (контейнеры стартуют не одновременно). */
export async function connectAdmin(
  env: OpsEnv,
  database: string,
  log: Log,
  attempts = 60,
): Promise<Pool> {
  const pool = createPool(adminUrl(env, database), { max: 2, onError: () => {} });
  for (let attempt = 1; ; attempt++) {
    try {
      await pool.query('select 1');
      return pool;
    } catch (error) {
      if (attempt >= attempts) {
        await pool.end();
        throw new Error('Database is not reachable', { cause: error });
      }
      if (attempt === 1) log.info('waiting for the database');
      await sleep(2000);
    }
  }
}

/**
 * Роли, пароли ролей и база HomeCRM (ADR-0004). Повторный запуск безопасен: роли и база
 * создаются, только если их нет, а пароли выставляются заново из файла секретов.
 */
export async function bootstrapDatabase(env: OpsEnv, log: Log): Promise<void> {
  const pool = await connectAdmin(env, 'postgres', log);
  const client = await pool.connect();
  try {
    await createRoles(client);
    const passwords: Array<[string, string | undefined]> = [
      [DB_ROLES.owner, env.HOMECRM_OWNER_PASSWORD],
      [DB_ROLES.app, env.HOMECRM_APP_PASSWORD],
      [DB_ROLES.auth, env.HOMECRM_AUTH_PASSWORD],
      [DB_ROLES.worker, env.HOMECRM_WORKER_PASSWORD],
    ];
    for (const [role, password] of passwords) {
      if (password === undefined || password === '') continue;
      const { rows } = await client.query<{ statement: string }>(
        "select format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) as statement",
        [role, password],
      );
      const statement = rows[0]?.statement;
      if (statement) await client.query(statement);
    }
    const exists = await client.query('select 1 from pg_database where datname = $1', [
      env.DB_NAME,
    ]);
    if (exists.rows.length === 0) {
      await createDatabase(client, env.DB_NAME);
      log.info('database created', { database: env.DB_NAME });
    }
  } finally {
    client.release();
    await pool.end();
  }
}

export type RowCounts = Record<string, number>;

/**
 * Точное число строк в каждой таблице базы («схема.таблица»). Суперпользователь обходит RLS, поэтому
 * видит все строки. Выполняется внутри транзакции со снимком: число сходится с дампом.
 */
export async function countRows(client: Queryable): Promise<RowCounts> {
  const { rows: tables } = await client.query<{ schema: string; name: string }>(
    `select n.nspname as schema, c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and not c.relispartition
        and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
      order by 1, 2`,
  );
  const counts: RowCounts = {};
  for (const table of tables) {
    const { rows } = await client.query<{ n: string }>(
      `select count(*)::text as n from ${quoteIdent(table.schema)}.${quoteIdent(table.name)}`,
    );
    counts[`${table.schema}.${table.name}`] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

export interface MigrationState {
  /** Сколько миграций уже применено. */
  applied: number;
  /** Имена ещё не применённых миграций, по порядку. */
  pending: string[];
}

interface Journal {
  entries: Array<{ tag: string; when: number }>;
}

/**
 * Какие миграции ещё не применены. Правило то же, что у Drizzle: применяются записи журнала,
 * чьё время позже времени последней применённой.
 */
export async function migrationState(
  db: Queryable,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<MigrationState> {
  const journal = JSON.parse(
    await readFile(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const table = await db.query<{ present: boolean }>(
    "select to_regclass('drizzle.__drizzle_migrations') is not null as present",
  );
  if (!table.rows[0]?.present) {
    return { applied: 0, pending: journal.entries.map((entry) => entry.tag) };
  }
  const { rows } = await db.query<{ count: string; last: string | null }>(
    'select count(*)::text as count, max(created_at)::text as last from drizzle.__drizzle_migrations',
  );
  const applied = Number(rows[0]?.count ?? 0);
  const last = rows[0]?.last == null ? Number.NEGATIVE_INFINITY : Number(rows[0].last);
  return {
    applied,
    pending: journal.entries.filter((entry) => entry.when > last).map((entry) => entry.tag),
  };
}
