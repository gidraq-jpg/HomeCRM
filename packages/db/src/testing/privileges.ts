// Права ролей на таблицы и колонки: что выдано в базе и что должно быть выдано (ADR-0004, ADR-0005).
// Лишнее право — такая же ошибка, как отсутствующая политика: privileges.test.ts сравнивает оба списка
// построчно и падает на любом расхождении. Ожидаемое выводится из схемы recordTable() и явных списков ниже.
import { getTableColumns, getTableName } from 'drizzle-orm';
import type pg from 'pg';
import { DB_ROLES } from '../bootstrap.ts';
import { RECORD_HISTORY_TABLES, RECORD_TABLES } from '../schema.ts';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
/** `all` — все колонки таблицы, включая вычисляемые; иначе — перечисленные. */
type Columns = 'all' | readonly string[];
type TableGrants = Partial<Record<Privilege, Columns>>;

interface ColumnInfo {
  name: string;
  generated: boolean;
}

function columnsOf(table: object): ColumnInfo[] {
  return Object.values(getTableColumns(table as never)).map((column) => ({
    name: (column as { name: string }).name,
    generated: (column as { generated?: unknown }).generated !== undefined,
  }));
}

/** Колонки записи, которые приложение не меняет никогда: id, автор, время создания и изменения. */
const FROZEN = ['id', 'author_id', 'created_at', 'updated_at'];

export function expectedGrants(): Record<string, Record<string, TableGrants>> {
  const app: Record<string, TableGrants> = {
    record_links: { SELECT: 'all', INSERT: 'all', UPDATE: ['role', 'deleted_at'] },
    accounts: { SELECT: 'all' },
    spaces: { SELECT: 'all' },
    space_members: { SELECT: 'all', UPDATE: ['role', 'left_at', 'left_by', 'display_name'] },
    household_access: { SELECT: 'all' },
    member_profiles: {
      SELECT: 'all',
      UPDATE: ['display_name', 'photo_file_id', 'birth_date', 'phone'],
    },
    invitations: { SELECT: 'all', INSERT: 'all', UPDATE: ['revoked_at'] },
    login_events: { SELECT: 'all' },
    password_resets: { SELECT: 'all', UPDATE: ['acknowledged_at'] },
  };
  const worker: Record<string, TableGrants> = {
    record_links: {
      SELECT: ['id', 'left_table', 'left_id', 'right_table', 'right_id', 'deleted_at'],
      DELETE: 'all',
    },
    space_members: { SELECT: ['space_id', 'account_id', 'role', 'created_at', 'left_at'] },
  };
  // Обработчик убирает просроченное из таблиц входа; какие строки — решают политики *_worker_cleanup.
  for (const name of [
    'sessions',
    'verifications',
    'rate_limits',
    'login_locks',
    'login_name_attempts',
    'invitations',
    'login_events',
    'password_resets',
  ]) {
    worker[name] = { SELECT: 'all', DELETE: 'all' };
  }
  const auth: Record<string, TableGrants> = {
    accounts: { SELECT: 'all', INSERT: 'all', UPDATE: 'all' },
    spaces: { SELECT: 'all', INSERT: 'all' },
    space_members: { SELECT: 'all', INSERT: 'all', UPDATE: ['left_at', 'left_by'] },
    credentials: { SELECT: 'all', INSERT: 'all', UPDATE: 'all' },
    invitations: { SELECT: 'all', UPDATE: ['accepted_at', 'accepted_by'] },
    login_events: { INSERT: 'all' },
    password_resets: { SELECT: 'all', INSERT: 'all', UPDATE: ['completed_at'] },
  };
  for (const name of [
    'sessions',
    'verifications',
    'two_factors',
    'rate_limits',
    'login_locks',
    'login_name_attempts',
  ]) {
    auth[name] = { SELECT: 'all', INSERT: 'all', UPDATE: 'all', DELETE: 'all' };
  }

  for (const table of Object.values(RECORD_TABLES)) {
    const columns = columnsOf(table);
    const name = getTableName(table as never);
    // Приложение читает и вставляет всё, меняет всё, кроме неизменяемых полей и вычисляемых.
    app[name] = {
      SELECT: 'all',
      INSERT: 'all',
      UPDATE: columns
        .filter((column) => !column.generated && !FROZEN.includes(column.name))
        .map((column) => column.name),
    };
    // Обработчик не читает тексты: идентификаторы, место, ответственный и корзина.
    worker[name] = {
      SELECT: [
        'id',
        'space_id',
        'space_kind',
        'assignee_id',
        'deleted_at',
        ...columns.filter((column) => column.name === 'parent_id').map((column) => column.name),
      ],
      UPDATE: ['assignee_id'],
      DELETE: 'all',
    };
  }
  for (const history of Object.values(RECORD_HISTORY_TABLES)) {
    const name = getTableName(history as never);
    app[name] = { SELECT: 'all', INSERT: 'all' };
    worker[name] = { INSERT: 'all' };
  }
  return { [DB_ROLES.app]: app, [DB_ROLES.worker]: worker, [DB_ROLES.auth]: auth };
}

/** Что выдано в базе: строки «роль таблица право колонка» по всем таблицам схемы public. */
export async function actualGrants(admin: pg.Pool): Promise<Set<string>> {
  const roles = [DB_ROLES.app, DB_ROLES.worker, DB_ROLES.auth];
  const { rows } = await admin.query<{ line: string }>(
    `SELECT r.rolname || ' ' || c.relname || ' ' || p.priv || ' ' || a.attname AS line
     FROM pg_roles r
     CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE')) AS p(priv)
     JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE r.rolname = ANY($1) AND has_column_privilege(r.oid, c.oid, a.attnum, p.priv)
     UNION ALL
     SELECT r.rolname || ' ' || c.relname || ' ' || p.priv || ' *'
     FROM pg_roles r
     CROSS JOIN (VALUES ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
     JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     WHERE r.rolname = ANY($1) AND has_table_privilege(r.oid, c.oid, p.priv)`,
    [roles],
  );
  return new Set(rows.map((row) => row.line));
}

/** Все колонки таблиц схемы public по каталогу: чтобы раскрыть `all`. */
async function catalogColumns(admin: pg.Pool): Promise<Map<string, string[]>> {
  const { rows } = await admin.query<{ relname: string; attname: string }>(
    `SELECT c.relname, a.attname FROM pg_class c
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`,
  );
  const byTable = new Map<string, string[]>();
  for (const row of rows)
    byTable.set(row.relname, [...(byTable.get(row.relname) ?? []), row.attname]);
  return byTable;
}

/** Расхождения между выданным и должным: «лишнее» и «не хватает», по одной строке на право. */
export async function grantDifferences(admin: pg.Pool): Promise<string[]> {
  const columns = await catalogColumns(admin);
  const expected = new Set<string>();
  for (const [role, tables] of Object.entries(expectedGrants())) {
    for (const [table, grants] of Object.entries(tables)) {
      for (const [privilege, scope] of Object.entries(grants)) {
        if (privilege === 'DELETE') {
          expected.add(`${role} ${table} DELETE *`);
          continue;
        }
        const list = scope === 'all' ? (columns.get(table) ?? []) : scope;
        for (const column of list) expected.add(`${role} ${table} ${privilege} ${column}`);
      }
    }
  }
  const actual = await actualGrants(admin);
  return [
    ...[...actual].filter((line) => !expected.has(line)).map((line) => `лишнее: ${line}`),
    ...[...expected].filter((line) => !actual.has(line)).map((line) => `не хватает: ${line}`),
  ].sort();
}
