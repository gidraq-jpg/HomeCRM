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

  it('политики выданы только приложению и обработчику; обработчику — только очистка корзины', async () => {
    const { rows } = await database.admin.query<{ policyname: string; roles: string[] }>(
      `SELECT policyname, roles::text[] AS roles FROM pg_policies WHERE schemaname = 'public'`,
    );
    for (const { policyname, roles } of rows) {
      expect(roles, policyname).toHaveLength(1);
      if (roles[0] === DB_ROLES.worker) expect(policyname).toMatch(/_purge(_select)?$/);
      else expect(roles[0], policyname).toBe(DB_ROLES.app);
    }
  });

  it('нет функций SECURITY DEFINER: они обходят RLS (ADR-0004, пункт 6)', async () => {
    const { rows } = await database.admin.query(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'app') AND p.prosecdef`,
    );
    expect(rows).toEqual([]);
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
      for (const table of [
        'accounts',
        'spaces',
        'space_members',
        'notes',
        'shopping_items',
        'tasks',
      ]) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0], table).toEqual({ n: 0 });
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

    const visible = await database.worker.query('SELECT id FROM notes');
    expect(visible.rows).toEqual([{ id: ids.expired }]);
    // Даже без условия в запросе удаляется только просроченное.
    const purged = await database.worker.query('DELETE FROM notes');
    expect(purged.rowCount).toBe(1);
    const left = await database.admin.query('SELECT id FROM notes WHERE id = ANY($1)', [
      Object.values(ids),
    ]);
    expect(left.rows.map((row) => row.id).sort()).toEqual([ids.live, ids.recent].sort());

    for (const statement of [
      `UPDATE notes SET title = 'изменено'`,
      `INSERT INTO notes (space_id, space_kind, author_id, title) VALUES ('${anna.personalSpaceId}', 'personal', '${anna.id}', 'x')`,
      'SELECT id FROM accounts',
      'SELECT id FROM spaces',
    ]) {
      await expect(database.worker.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
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
