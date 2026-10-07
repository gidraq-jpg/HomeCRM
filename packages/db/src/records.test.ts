// Образец таблицы записей (records.ts): всё, что обязана иметь таблица пользовательских данных,
// проверяется по каталогу базы — так забытый шаг (триггер, FORCE, политика, история, матрица) роняет тест.
// Новая таблица записей — это один вызов recordTable() и одна строка app.attach_record_table() в миграции.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { RECORD_TYPES } from './access-sql.ts';
import { RECORD_DEFINITIONS, RECORD_HISTORY_TABLES, RECORD_TABLES } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
});

afterAll(async () => {
  await database?.drop();
});

const names = (rows: ReadonlyArray<{ name: string }>) => rows.map((row) => row.name).sort();

describe('таблицы записей в коде и в базе', () => {
  it('таблицы с общими полями доступа в базе — ровно те, что объявлены через recordTable()', async () => {
    const { rows } = await database.admin.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_class c
       WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'author_id' AND NOT a.attisdropped)
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'space_id' AND NOT a.attisdropped)
         AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'deleted_at' AND NOT a.attisdropped)
         AND c.relname NOT LIKE '%\\_history'`,
    );
    expect(names(rows)).toEqual(RECORD_DEFINITIONS.map((definition) => definition.name).sort());
  });

  it('у каждого вида записи есть таблица, история и своя запись в перечне матрицы', () => {
    const types = RECORD_DEFINITIONS.map((definition) => definition.type).sort();
    expect(types).toEqual([...RECORD_TYPES].sort());
    expect(Object.keys(RECORD_TABLES).sort()).toEqual(types);
    expect(Object.keys(RECORD_HISTORY_TABLES).sort()).toEqual(types);
  });
});

describe.each(RECORD_DEFINITIONS.map((definition) => [definition.name, definition] as const))(
  'таблица %s подключена к защите',
  (name, definition) => {
    it('RLS включена и принудительна — у записей и у истории', async () => {
      const { rows } = await database.admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1)`,
        [[name, `${name}_history`]],
      );
      expect(rows).toHaveLength(2);
      for (const row of rows)
        expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    });

    it('на таблице висят все триггеры: ответственный и время, защита полей и корзины, время корзины, история', async () => {
      const { rows } = await database.admin.query<{ name: string; fn: string }>(
        `SELECT t.tgname AS name, p.proname AS fn FROM pg_trigger t
       JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal`,
        [`public.${name}`],
      );
      expect(Object.fromEntries(rows.map((row) => [row.name, row.fn]))).toEqual({
        [`${name}_defaults`]: 'record_defaults',
        [`${name}_guard`]: 'record_guard',
        [`${name}_trash_time`]: 'guard_trash_time',
        [`${name}_history`]: 'record_history',
        ...(name === 'notes' ? { notes_placement: 'cascade_note_placement' } : {}),
        ...(name === 'note_items' ? { note_items_00_parent_lock: 'lock_note_parent' } : {}),
        [`${name}_links_purge`]: 'purge_record_links',
        ...(['notes', 'objects'].includes(name)
          ? { [`${name}_files_placement`]: 'cascade_file_placement' }
          : {}),
        ...(['note_files', 'object_files'].includes(name)
          ? { [`${name}_00_lifecycle`]: 'file_lifecycle' }
          : {}),
        ...(name === 'objects' ? { objects_placement: 'cascade_object_placement' } : {}),
        ...(['object_fields', 'object_events'].includes(name)
          ? { [`${name}_00_parent_lock`]: 'lock_object_parent' }
          : {}),
        ...(name === 'object_events' ? { object_events_01_snapshot: 'event_snapshot' } : {}),
        ...(name === 'object_fields' ? { object_fields_01_limits: 'object_field_limits' } : {}),
        // Живая дочерняя запись при родителе в корзине невозможна.
        ...(definition.parent === null ? {} : { [`${name}_parent_live`]: 'guard_parent_live' }),
        // Родитель убирает дочерние записи в корзину вместе с собой.
        ...Object.fromEntries(
          RECORD_DEFINITIONS.filter((child) => child.parent === name).map((child) => [
            `${name}_cascade_${child.name}`,
            child.name === 'object_events' ? 'cascade_object_events' : 'cascade_trash',
          ]),
        ),
      });
    });

    it('есть все политики: приложение — чтение, создание, изменение; обработчик — очистка корзины и передача записей; история — чтение и вставка', async () => {
      const { rows } = await database.admin.query<{
        tablename: string;
        policyname: string;
        cmd: string;
      }>(
        `SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1)`,
        [[name, `${name}_history`]],
      );
      expect(rows.map((row) => `${row.tablename}.${row.policyname}:${row.cmd}`).sort()).toEqual(
        [
          `${name}.${name}_select:SELECT`,
          `${name}.${name}_insert:INSERT`,
          `${name}.${name}_update:UPDATE`,
          `${name}.${name}_purge_select:SELECT`,
          `${name}.${name}_purge:DELETE`,
          `${name}.${name}_reassign_select:SELECT`,
          `${name}.${name}_reassign:UPDATE`,
          ...(name === 'object_events'
            ? [
                'object_events.object_events_contact_purge_select:SELECT',
                'object_events.object_events_contact_purge:UPDATE',
              ]
            : []),
          `${name}_history.${name}_history_select:SELECT`,
          `${name}_history.${name}_history_insert:INSERT`,
          `${name}_history.${name}_history_worker_insert:INSERT`,
        ].sort(),
      );
    });

    if (definition.parent !== null) {
      it(`дочерняя таблица: внешние ключи на ${definition.parent} отложены, а корзина идёт вслед за родителем`, async () => {
        const { rows } = await database.admin.query<{
          conname: string;
          condeferrable: boolean;
          condeferred: boolean;
        }>(
          `SELECT conname, condeferrable, condeferred FROM pg_constraint
         WHERE conrelid = $1::regclass AND contype = 'f' AND confrelid = $2::regclass
           AND conname LIKE '%\\_parent\\_%'`,
          [`public.${name}`, `public.${definition.parent}`],
        );
        expect(rows.map((row) => row.conname).sort()).toEqual([
          `${name}_parent_audience_fk`,
          `${name}_parent_space_fk`,
        ]);
        for (const row of rows)
          expect(row).toMatchObject({ condeferrable: true, condeferred: true });
        const cascade = await database.admin.query(
          `SELECT 1 FROM pg_trigger WHERE tgrelid = $1::regclass AND tgname = $2`,
          [`public.${definition.parent}`, `${definition.parent}_cascade_${name}`],
        );
        expect(cascade.rowCount).toBe(1);
      });
    }
  },
);

describe('в базе нет таблицы, которой не знает ни одна матрица', () => {
  // Каждая таблица схемы закреплена за матрицей: записи — access-matrix.test.ts (таблицы берутся из
  // recordTable()); пространства, участники, учётные записи — spaces-matrix.test.ts; приглашения,
  // журнал входов и сброс пароля — identity-matrix.test.ts; пароли, секреты, сессии и счётчики приложению
  // не выданы вовсе — context.test.ts и auth-rls.test.ts.
  const SPACES = ['accounts', 'space_members', 'spaces', 'household_access', 'member_profiles'];
  const IDENTITY = ['invitations', 'login_events', 'password_resets'];
  const AUTH_ONLY = [
    'credentials',
    'login_locks',
    'login_name_attempts',
    'rate_limits',
    'sessions',
    'two_factors',
    'verifications',
  ];

  it('новая таблица должна быть добавлена в матрицу — иначе этот тест красный', async () => {
    const { rows } = await database.admin.query<{ name: string }>(
      `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public'`,
    );
    const covered = new Set([
      'file_blobs', // files.test.ts: реестр ключей, без пользовательских метаданных.
      'record_links', // objects-matrix.test.ts: оба конца и право записи хотя бы в один.
      ...SPACES,
      ...IDENTITY,
      ...AUTH_ONLY,
      ...RECORD_DEFINITIONS.flatMap((definition) => [
        definition.name,
        `${definition.name}_history`,
      ]),
    ]);
    expect(names(rows).filter((name) => !covered.has(name))).toEqual([]);
  });
});
