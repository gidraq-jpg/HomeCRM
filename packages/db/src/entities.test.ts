// Тест полноты паспортов (ADR-0054): реестр entities.ts сверяется со свежей базой после всех
// миграций, с файлами матриц, кодом архива экспорта, PRD и ADR.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { ExportRecords } from '@homecrm/shared';
import { getTableName } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  ENTITY_REGISTRY,
  type EntityException,
  type EntityPassport,
  SERVICE_TABLES,
} from './entities.ts';
import { RECORD_HISTORY_TABLES, RECORD_TABLES } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';

const ROOT = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');
const ARCHIVE = read('apps/server/src/export/archive.ts');
const HISTORY_BLOCK = /const HISTORY_TABLES = \[([^\]]*)\]/.exec(ARCHIVE)?.[1] ?? '';
const ARCHIVE_WITHOUT_HISTORY = ARCHIVE.replace(HISTORY_BLOCK, '');
const PRD = read('docs/02-prd.md');
const ADRS = readdirSync(new URL('docs/adr/', ROOT));
const OWN_ACCESS = ['space_id', 'space_kind', 'audience', 'author_id', 'assignee_id', 'deleted_at'];
const GENERIC_MATRIX = new Set(
  [...Object.values(RECORD_TABLES), ...Object.values(RECORD_HISTORY_TABLES)].map((table) =>
    getTableName(table),
  ),
);

interface Catalog {
  tables: string[];
  columns: Map<string, Set<string>>;
  rls: Map<string, boolean>;
  policies: Map<string, Set<string>>;
  searchTriggers: Set<string>;
  foreignKeys: Set<string>;
}

/** Каталог базы: все таблицы вне системных схем, колонки, RLS, политики, триггеры поиска, FK. */
async function readCatalog(admin: pg.Pool): Promise<Catalog> {
  const tables = await admin.query<{ name: string; rls: boolean }>(`
    SELECT CASE WHEN n.nspname = 'public' THEN c.relname ELSE n.nspname || '.' || c.relname END AS name,
      c.relrowsecurity AND c.relforcerowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1`);
  const columns = await admin.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const policies = await admin.query<{ tablename: string; policyname: string }>(
    `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`,
  );
  const triggers = await admin.query<{ name: string }>(`
    SELECT DISTINCT c.relname AS name FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE NOT t.tgisinternal AND n.nspname = 'app' AND p.proname = 'sync_search_entry'`);
  const keys = await admin.query<{ edge: string }>(`
    SELECT DISTINCT c.relname || '>' || r.relname AS edge FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class r ON r.oid = k.confrelid
    WHERE k.contype = 'f'`);
  const group = (rows: Array<[string, string]>) => {
    const map = new Map<string, Set<string>>();
    for (const [key, value] of rows) map.set(key, (map.get(key) ?? new Set()).add(value));
    return map;
  };
  return {
    tables: tables.rows.map((row) => row.name),
    rls: new Map(tables.rows.map((row) => [row.name, row.rls])),
    columns: group(columns.rows.map((row) => [row.table_name, row.column_name])),
    policies: group(policies.rows.map((row) => [row.tablename, row.policyname])),
    searchTriggers: new Set(triggers.rows.map((row) => row.name)),
    foreignKeys: new Set(keys.rows.map((row) => row.edge)),
  };
}

const isException = (value: unknown): value is EntityException =>
  typeof value === 'object' && value !== null && ('no' in value || 'gap' in value);

function refExists(ref: string): boolean {
  const adr = /^ADR-(\d{4})$/.exec(ref);
  if (adr) return ADRS.some((file) => file.startsWith(`${adr[1]}-`));
  return /^[A-Z]+-\d+$/.test(ref) && PRD.includes(`**${ref}.**`);
}

function exportedInArchive(passport: EntityPassport): boolean {
  const base = passport.table.replace(/_history$/, '');
  return passport.table.endsWith('_history')
    ? HISTORY_BLOCK.includes(`'${base}'`)
    : new RegExp(`\\b${passport.table}\\b`).test(ARCHIVE_WITHOUT_HISTORY);
}

/** Все расхождения реестра с базой и кодом; пустой список — паспорта полны. */
function passportProblems(catalog: Catalog): string[] {
  const problems: string[] = [];
  const registered = new Set(ENTITY_REGISTRY.map((passport) => passport.table));
  const has = (table: string, column: string) => catalog.columns.get(table)?.has(column) ?? false;

  for (const table of catalog.tables)
    if (!registered.has(table) && !(table in SERVICE_TABLES))
      problems.push(`таблица ${table} добавлена без паспорта`);
  for (const table of [...registered, ...Object.keys(SERVICE_TABLES)])
    if (!catalog.tables.includes(table)) problems.push(`${table}: в реестре, но нет в базе`);
  for (const table of registered)
    if (table in SERVICE_TABLES) problems.push(`${table}: и в реестре, и в служебном списке`);
  if (registered.size !== ENTITY_REGISTRY.length) problems.push('в реестре есть повторы');

  for (const passport of ENTITY_REGISTRY) {
    const { table } = passport;
    if (!catalog.tables.includes(table)) continue;
    const fail = (text: string) => problems.push(`${table}: ${text}`);
    const checkRef = (ref: string | undefined) => {
      if (ref !== undefined && !refExists(ref)) fail(`ссылка ${ref} не найдена в PRD и ADR`);
    };

    // Поля доступа.
    const { access } = passport;
    if (access === 'own') {
      for (const column of OWN_ACCESS) if (!has(table, column)) fail(`нет поля доступа ${column}`);
    } else if ('inherits' in access) {
      if (!registered.has(access.inherits)) fail(`родитель ${access.inherits} без паспорта`);
      if (!has(table, access.via)) fail(`нет колонки ${access.via}`);
    } else {
      for (const column of access.columns) if (!has(table, column)) fail(`нет колонки ${column}`);
      checkRef(access.ref);
    }

    // RLS и политика.
    if (!catalog.rls.get(table)) fail('RLS не включён принудительно (ENABLE + FORCE)');
    if (!catalog.policies.get(table)?.has(passport.policy)) fail(`нет политики ${passport.policy}`);

    // Матрица доступа.
    const matrix = new URL(`packages/db/src/${passport.matrix}`, ROOT);
    if (!existsSync(matrix)) fail(`нет файла матрицы ${passport.matrix}`);
    else if (
      !new RegExp(`\\b${table}\\b`).test(readFileSync(matrix, 'utf8')) &&
      !(passport.matrix === 'access-matrix.test.ts' && GENERIC_MATRIX.has(table))
    )
      fail(`матрица ${passport.matrix} не упоминает таблицу`);

    // Поиск.
    const indexed = catalog.searchTriggers.has(table);
    if (passport.search === 'indexed') {
      if (!indexed) fail('заявлено «индексируется», но триггера app.sync_search_entry нет');
    } else {
      if (indexed) fail('заявлено «не ищется», но триггер поиска есть — обновите паспорт');
      if ('ref' in passport.search) checkRef(passport.search.ref);
    }

    // Экспорт.
    const exported = exportedInArchive(passport);
    if (isException(passport.export)) {
      if (exported) fail('заявлено «не выгружается», но таблица есть в архиве — обновите паспорт');
      if ('ref' in passport.export) checkRef(passport.export.ref);
    } else {
      if (!(passport.export.section in ExportRecords))
        fail(`раздела ${passport.export.section} нет в ExportRecords`);
      if (!exported) fail('заявлено «выгружается», но в коде архива таблицы нет');
    }

    // Корзина.
    const { trash } = passport;
    if (trash === 'soft') {
      if (!has(table, 'deleted_at')) fail('заявлена корзина, но нет колонки deleted_at');
    } else if ('withParent' in trash) {
      if (!registered.has(trash.withParent)) fail(`родитель ${trash.withParent} без паспорта`);
      if (!catalog.foreignKeys.has(`${table}>${trash.withParent}`))
        fail(`нет внешнего ключа на ${trash.withParent}`);
    } else checkRef(trash.ref);
  }
  return problems;
}

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
});

afterAll(async () => {
  await database?.drop();
});

describe('паспорт сущности', () => {
  it('у каждой таблицы базы есть паспорт или место в служебном списке, и паспорта верны', async () => {
    expect(passportProblems(await readCatalog(database.admin))).toEqual([]);
  });

  it('открытые пробелы перечислены явно', () => {
    const gaps = ENTITY_REGISTRY.flatMap((passport) =>
      (['search', 'export', 'trash'] as const)
        .filter((key) => {
          const value = passport[key];
          return typeof value === 'object' && 'gap' in value;
        })
        .map((key) => `${passport.table}.${key}`),
    );
    expect(gaps).toEqual([]);
  });

  // Тест самого теста: временная таблица без паспорта и испорченная запись находятся.
  it('таблица без паспорта роняет проверку', async () => {
    const client = await database.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE public.zz_probe (id uuid PRIMARY KEY, title text)');
      await client.query('CREATE TABLE app.zz_probe_extra (id uuid PRIMARY KEY)');
      const problems = passportProblems(await readCatalogInside(client));
      expect(problems).toEqual([
        'таблица app.zz_probe_extra добавлена без паспорта',
        'таблица zz_probe добавлена без паспорта',
      ]);
      await client.query('ALTER TABLE notes NO FORCE ROW LEVEL SECURITY');
      await client.query('DROP TRIGGER notes_search ON notes');
      expect(passportProblems(await readCatalogInside(client))).toEqual(
        expect.arrayContaining([
          'notes: RLS не включён принудительно (ENABLE + FORCE)',
          'notes: заявлено «индексируется», но триггера app.sync_search_entry нет',
        ]),
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

/** Каталог внутри открытой транзакции: временные изменения видны только этому соединению. */
function readCatalogInside(client: pg.PoolClient): Promise<Catalog> {
  return readCatalog({ query: client.query.bind(client) } as unknown as pg.Pool);
}
