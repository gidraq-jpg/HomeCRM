// Роли базы и защита от обхода RLS (ADR-0004): кто владеет таблицами, кому выданы политики,
// что приложение не может отключить защиту, а владелец и обработчик видят только положенное.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DB_ROLES } from './bootstrap.ts';
import { createAppDatabase } from './client.ts';
import { notes } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import { isDenied } from './testing/matrix.ts';

const family = buildFamily();
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
});

afterAll(async () => {
  await database?.drop();
});

const OUR_ROLES = Object.values(DB_ROLES);

describe('роли базы', () => {
  it('ни одна роль HomeCRM не суперпользователь и не обходит RLS', async () => {
    const { rows } = await database.admin.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication, rolcanlogin
       FROM pg_roles WHERE rolname = ANY($1) ORDER BY rolname`,
      [OUR_ROLES],
    );
    expect(rows).toEqual(
      [...OUR_ROLES].sort().map((rolname) => ({
        rolname,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolreplication: false,
        rolcanlogin: true,
      })),
    );
    // Роли не входят друг в друга: приложение не может стать владельцем.
    const membership = await database.admin.query(
      `SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
       WHERE r.rolname = ANY($1)`,
      [OUR_ROLES],
    );
    expect(membership.rows[0]).toEqual({ n: 0 });
  });

  it('таблицами владеет homecrm_owner, RLS включена и принудительна на каждой', async () => {
    const { rows } = await database.admin.query(
      `SELECT c.relname, pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('public', 'app') AND c.relkind IN ('r', 'p') ORDER BY c.relname`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, row.relname).toMatchObject({
        owner: DB_ROLES.owner,
        relrowsecurity: true,
        relforcerowsecurity: true,
      });
    }
  });

  it('политики выданы приложению, обработчику и службе входа; обработчику — очистка корзины и передача записей ушедшего', async () => {
    const { rows } = await database.admin.query<{ policyname: string; roles: string[] }>(
      `SELECT policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public'`,
    );
    for (const { policyname, roles } of rows) {
      expect(roles, policyname).toHaveLength(1);
      if (roles[0] === DB_ROLES.worker) {
        expect(policyname).toMatch(
          /_purge(_select)?$|_reassign(_select)?$|_history_worker_insert$|^space_members_worker_select$|_worker_cleanup(_select)?$|^file_blobs_worker_(select|delete)$|^spaces_timezone_(worker|initialize)$|^deadlines_(engine|refresh)$|^deadline_(occurrences|notifications)_worker_(select|insert|update|delete)$|^(notes|objects|meters|meter_readings)_deadline_worker_select$|^(push_(subscriptions|attempts|deliveries)|notification_settings)_worker_(select|insert|update|delete)$/,
        );
      } else if (roles[0] === DB_ROLES.owner) {
        expect([
          'household_access_sync',
          'member_profiles_initialize',
          'search_index_sync',
          'push_subscriptions_leave',
          'deadlines_owner_select',
          'deadlines_owner_update',
          'deadline_occurrences_owner_select',
          'deadline_occurrences_owner_update',
        ]).toContain(policyname);
      } else if (roles[0] === DB_ROLES.auth) expect(policyname).toMatch(/_auth_/);
      else expect(roles[0], policyname).toBe(DB_ROLES.app);
    }
  });

  it('SECURITY DEFINER только у закрытых триггеров ADR-0022 и ADR-0027; runtime-роли не вызывают их', async () => {
    const { rows } = await database.admin.query(
      `SELECT p.proname, pg_get_userbyid(p.proowner) AS owner,
         has_function_privilege('homecrm_app', p.oid, 'EXECUTE') AS app,
         has_function_privilege('homecrm_auth', p.oid, 'EXECUTE') AS auth,
         has_function_privilege('homecrm_worker', p.oid, 'EXECUTE') AS worker
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'app') AND p.prosecdef ORDER BY p.proname`,
    );
    expect(rows).toEqual(
      [
        'claim_push_endpoint',
        'initialize_member_profile',
        'remove_member_push',
        'sync_household_access',
        'sync_search_entry',
        'sync_source_deadlines',
      ].map((proname) => ({
        proname,
        owner: DB_ROLES.owner,
        app: false,
        auth: false,
        worker: false,
      })),
    );
  });
});

describe('обойти RLS нельзя', () => {
  it('приложение не отключает RLS, не меняет роль и не удаляет мимо корзины', async () => {
    const client = await database.app.connect();
    try {
      for (const statement of [
        'ALTER TABLE notes DISABLE ROW LEVEL SECURITY',
        'ALTER TABLE notes NO FORCE ROW LEVEL SECURITY',
        'DROP POLICY notes_select ON notes',
        `SET ROLE ${DB_ROLES.owner}`,
        'DELETE FROM notes',
        'TRUNCATE notes',
        'CREATE TABLE leak (id int)',
      ]) {
        await expect(client.query(statement), statement).rejects.toMatchObject({ code: '42501' });
      }
      // row_security = off не снимает политики с роли без BYPASSRLS: запрос падает, а не обходит их.
      await client.query('SET row_security = off');
      await expect(client.query('SELECT id FROM notes')).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release(true); // соединение с изменёнными настройками в пул не возвращается
    }
  });

  it('владелец таблиц без своих политик не видит ни одной строки — даже с контекстом', async () => {
    const client = await database.owner.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.account_id', $1, true)`, [
        family.person('anna').id,
      ]);
      const tables = await client.query<{ tablename: string }>(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
      );
      expect(tables.rows.length).toBeGreaterThanOrEqual(15);
      for (const { tablename } of tables.rows) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tablename}`);
        expect(rows[0], tablename).toEqual({ n: 0 });
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('обработчик видит и удаляет только то, что пролежало в корзине дольше 30 дней', async () => {
    const anna = family.person('anna');
    const ids = { live: randomUUID(), recent: randomUUID(), expired: randomUUID() };
    await database.admin.query(
      `INSERT INTO notes (id, space_id, space_kind, author_id, title, deleted_at) VALUES
        ($1, $4, 'personal', $5, 'живая', NULL),
        ($2, $4, 'personal', $5, 'в корзине со вчера', now() - interval '1 day'),
        ($3, $4, 'personal', $5, 'в корзине давно', now() - interval '31 days')`,
      [ids.live, ids.recent, ids.expired, anna.personalSpaceId, anna.id],
    );

    // Из корзины обработчик видит только просроченное; личного и живого личного — не видит вовсе.
    // (Живые общие записи он видит лишь в части передачи записей ушедшего: id, место и ответственный.)
    const visible = await database.worker.query(
      'SELECT id FROM notes WHERE deleted_at IS NOT NULL',
    );
    expect(visible.rows).toEqual([{ id: ids.expired }]);
    const personalLive = await database.worker.query(
      `SELECT id FROM notes WHERE deleted_at IS NULL AND space_kind = 'personal'`,
    );
    expect(personalLive.rows).toEqual([]);
    // Даже без условия в запросе удаляется только просроченное.
    const purged = await database.worker.query('DELETE FROM notes');
    expect(purged.rowCount).toBe(1);
    const left = await database.admin.query('SELECT id FROM notes WHERE id = ANY($1)', [
      Object.values(ids),
    ]);
    expect(left.rows.map((row) => row.id).sort()).toEqual([ids.live, ids.recent].sort());

    // Тексты записей обработчику не выданы: только id, место, ответственный и отметка корзины.
    for (const statement of [
      'SELECT title FROM notes',
      'SELECT * FROM notes',
      'SELECT body FROM notes',
    ]) {
      await expect(database.worker.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
    for (const statement of [
      `UPDATE notes SET title = 'изменено'`,
      `INSERT INTO notes (space_id, space_kind, author_id, title) VALUES ('${anna.personalSpaceId}', 'personal', '${anna.id}', 'x')`,
      'SELECT id FROM accounts',
      'SELECT name FROM spaces',
    ]) {
      await expect(database.worker.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
    const workerHouses = await database.worker.query('SELECT id,kind,time_zone FROM spaces');
    expect(workerHouses.rows.every((row) => row.kind === 'household')).toBe(true);
  });
});

describe('корзину нельзя обойти датой (DATA-1)', () => {
  const longAgo = new Date('2000-01-01T00:00:00Z');

  /** Общая заметка Анны «Вся семья»: Борис может убрать её в корзину, но не восстановить. */
  async function insertNote(deletedAt: 'now' | 'day ago' | null): Promise<string> {
    const [home] = family.houses;
    const id = randomUUID();
    await database.admin.query(
      `INSERT INTO notes (id, space_id, space_kind, audience, author_id, title, deleted_at)
       VALUES ($1, $2, 'household', 'household', $3, 'общая заметка',
         CASE $4::text WHEN 'now' THEN now() WHEN 'day ago' THEN now() - interval '1 day' END)`,
      [id, home?.id, family.person('anna').id, deletedAt],
    );
    return id;
  }

  async function worker(statement: string, id: string): Promise<number> {
    return (await database.worker.query(statement, [id])).rowCount ?? 0;
  }

  it('перенос в корзину с прошедшей датой: дату ставит база, обработчик запись не видит и не удаляет', async () => {
    const id = await insertNote(null);
    const app = createAppDatabase(database.app);
    const moved = await app.withAccount(family.person('boris').id, (tx) =>
      tx.update(notes).set({ deletedAt: longAgo }).where(eq(notes.id, id)),
    );
    expect(moved.rowCount).toBe(1); // в корзину — можно
    const { rows } = await database.admin.query(
      `SELECT deleted_at > now() - interval '1 minute' AS fresh FROM notes WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ fresh: true }]);
    expect(await worker('SELECT id FROM notes WHERE id = $1', id)).toBe(0);
    expect(await worker('DELETE FROM notes WHERE id = $1', id)).toBe(0);
  });

  it('дату записи в корзине переписать нельзя — только восстановить', async () => {
    const id = await insertNote('day ago');
    const app = createAppDatabase(database.app);
    const anna = family.person('anna').id; // администратор: ей можно восстанавливать
    for (const date of [longAgo, new Date()]) {
      await expect(
        app.withAccount(anna, (tx) =>
          tx.update(notes).set({ deletedAt: date }).where(eq(notes.id, id)),
        ),
      ).rejects.toSatisfy(isDenied);
    }
    const { rows } = await database.admin.query(
      `SELECT deleted_at BETWEEN now() - interval '25 hours' AND now() - interval '23 hours' AS untouched
       FROM notes WHERE id = $1`,
      [id],
    );
    expect(rows).toEqual([{ untouched: true }]);
    const restored = await app.withAccount(anna, (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, id)),
    );
    expect(restored.rowCount).toBe(1);
  });
});
