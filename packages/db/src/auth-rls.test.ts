// Таблицы входа и RLS (ADR-0005 «таблицы библиотеки получают политики RLS по ADR-0004»):
// кто что видит и чем распоряжается — приложение, служба входа и владелец таблиц.
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DB_ROLES } from './bootstrap.ts';
import { type AppDatabase, createAppDatabase } from './client.ts';
import { accounts } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import { isDenied } from './testing/matrix.ts';

const family = buildFamily();
const [anna, boris, vera, gleb] = ['anna', 'boris', 'vera', 'gleb'].map((key) =>
  family.person(key as 'anna'),
);
const home = family.houses[0];
let database: TestDatabase;
let app: AppDatabase;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  app = createAppDatabase(database.app);
  if (anna === undefined || home === undefined) throw new Error('No family');
  // По строке во всех таблицах входа: отказ ниже — это отказ в праве, а не «таблица пуста».
  const seed = (statement: string, params: unknown[] = []) =>
    database.admin.query(statement, params);
  await seed(
    `INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
    [anna.id, randomUUID()],
  );
  await seed(
    `INSERT INTO credentials (user_id, account_id, provider_id, password) VALUES ($1, $2, 'credential', 'hash')`,
    [anna.id, anna.id],
  );
  await seed(
    `INSERT INTO verifications (identifier, value, expires_at) VALUES ('x', 'y', now() + interval '1 day')`,
  );
  await seed(`INSERT INTO two_factors (user_id, secret, backup_codes) VALUES ($1, 's', 'b')`, [
    anna.id,
  ]);
  await seed(`INSERT INTO rate_limits (key, count, last_request) VALUES ('k', 1, 1)`);
  await seed(`INSERT INTO login_locks (account_id, failures) VALUES ($1, 1)`, [anna.id]);
});

afterAll(async () => {
  await database?.drop();
});

// Таблица → колонка, на которой пробуется UPDATE.
const AUTH_ONLY: Record<string, string> = {
  sessions: 'token',
  credentials: 'password',
  verifications: 'value',
  two_factors: 'secret',
  rate_limits: 'count',
  login_locks: 'failures',
};

/** Выполняет запрос от имени участника; отказ в праве — это 42501. */
const asApp = (accountId: string, statement: string) =>
  app.withAccount(accountId, (tx) => tx.execute(sql.raw(statement)));

const reject = (promise: Promise<unknown>, label: string) =>
  expect(promise, label).rejects.toSatisfy(isDenied);

describe('приложение (homecrm_app)', () => {
  it('не видит и не меняет пароли, секреты, сессии и счётчики — даже под контекстом участника', async () => {
    for (const [table, column] of Object.entries(AUTH_ONLY)) {
      for (const statement of [
        `SELECT * FROM ${table}`,
        `UPDATE ${table} SET ${column} = ${column}`,
        `DELETE FROM ${table}`,
      ]) {
        await reject(asApp(anna?.id ?? '', statement), `${table}: ${statement}`);
      }
    }
    await reject(
      asApp(
        anna?.id ?? '',
        `INSERT INTO sessions (user_id, token, expires_at) VALUES ('${anna?.id}', 'stolen', now())`,
      ),
      'вставить сессию',
    );
  });

  it('в accounts видит только свою строку, без секретов; создавать и менять учётные записи не может', async () => {
    const rows = await app.withAccount(boris?.id ?? '', (tx) => tx.select().from(accounts));
    expect(rows.map((row) => row.id)).toEqual([boris?.id]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(
      [
        'createdAt',
        'displayName',
        'displayUsername',
        'email',
        'emailVerified',
        'id',
        'image',
        'twoFactorEnabled',
        'updatedAt',
        'username',
      ].sort(),
    );
    for (const statement of [
      `UPDATE accounts SET display_name = 'взлом'`,
      `UPDATE accounts SET two_factor_enabled = false`,
      `INSERT INTO accounts (display_name, email) VALUES ('x', 'x@x.test')`,
      'DELETE FROM accounts',
    ]) {
      await reject(asApp(boris?.id ?? '', statement), statement);
    }
  });
});

describe('служба входа (homecrm_auth)', () => {
  it('находит учётную запись по имени без контекста участника — ради этого роль и нужна', async () => {
    const { rows } = await database.auth.query('SELECT id FROM accounts WHERE username = $1', [
      'anna',
    ]);
    expect(rows).toEqual([{ id: anna?.id }]);
    expect(
      (await database.auth.query('SELECT count(*)::int AS n FROM space_members')).rows[0]?.n,
    ).toBeGreaterThan(0);
  });

  it('не видит и не меняет данные семьи', async () => {
    for (const table of ['notes', 'shopping_items', 'tasks']) {
      for (const statement of [
        `SELECT * FROM ${table}`,
        `UPDATE ${table} SET title = 'x'`,
        `DELETE FROM ${table}`,
        `INSERT INTO ${table} (space_id, space_kind, author_id, title) VALUES ('${anna?.personalSpaceId}', 'personal', '${anna?.id}', 'x')`,
        `TRUNCATE ${table}`,
      ]) {
        await expect(database.auth.query(statement), statement).rejects.toMatchObject({
          code: '42501',
        });
      }
    }
  });

  it('не удаляет и не переименовывает учётные записи, дома и участников', async () => {
    for (const statement of [
      'DELETE FROM accounts',
      'DELETE FROM spaces',
      'DELETE FROM space_members',
      `UPDATE spaces SET name = 'взлом'`,
      `UPDATE space_members SET role = 'admin'`,
      'TRUNCATE accounts CASCADE',
    ]) {
      await expect(database.auth.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('не снимает защиту: ни RLS, ни политик, ни роли', async () => {
    const client = await database.auth.connect();
    try {
      for (const statement of [
        'ALTER TABLE sessions DISABLE ROW LEVEL SECURITY',
        'DROP POLICY sessions_auth_select ON sessions',
        `SET ROLE ${DB_ROLES.owner}`,
        'CREATE TABLE leak (id int)',
      ]) {
        await expect(client.query(statement), statement).rejects.toMatchObject({ code: '42501' });
      }
      await client.query('SET row_security = off');
      await expect(client.query('SELECT id FROM sessions')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      client.release(true);
    }
  });
});

describe('журнал входов', () => {
  it('служба входа пишет, но не читает и не правит; приложение читает только своё и не пишет', async () => {
    const id = randomUUID();
    await database.auth.query(
      `INSERT INTO login_events (id, account_id, kind, outcome, ip_address, user_agent) VALUES ($1, $2, 'sign_in', 'failure', '198.51.100.1', 'Test/1')`,
      [id, vera?.id],
    );
    for (const statement of [
      'SELECT * FROM login_events',
      `UPDATE login_events SET outcome = 'success'`,
      'DELETE FROM login_events',
    ]) {
      await expect(database.auth.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
    const own = await asApp(vera?.id ?? '', 'SELECT id FROM login_events');
    expect(own.rows.map((row) => row.id)).toContain(id);
    const others = await asApp(gleb?.id ?? '', 'SELECT id FROM login_events');
    expect(others.rows).toEqual([]);
    for (const statement of [
      `INSERT INTO login_events (account_id, kind, outcome) VALUES ('${vera?.id}', 'sign_in', 'success')`,
      `UPDATE login_events SET outcome = 'success'`,
      'DELETE FROM login_events',
    ]) {
      await reject(asApp(vera?.id ?? '', statement), statement);
    }
  });
});

describe('сброс пароля ребёнка: отметка', () => {
  async function seedReset(completed: boolean): Promise<string> {
    const id = randomUUID();
    await database.admin.query(
      `INSERT INTO password_resets (id, account_id, requested_by, expires_at, completed_at)
       VALUES ($1, $2, $3, now() + interval '1 day', ${completed ? 'now()' : 'NULL'})`,
      [id, vera?.id, anna?.id],
    );
    return id;
  }

  it('ребёнок видит свою отметку и может подтвердить, что прочитал; чужая строка ему недоступна', async () => {
    const id = await seedReset(true);
    const own = await asApp(vera?.id ?? '', `SELECT id FROM password_resets WHERE id = '${id}'`);
    expect(own.rows).toHaveLength(1);
    for (const stranger of [anna, boris, gleb]) {
      const rows = await asApp(
        stranger?.id ?? '',
        `SELECT id FROM password_resets WHERE id = '${id}'`,
      );
      expect(rows.rows, stranger?.name).toEqual([]);
      const update = await asApp(
        stranger?.id ?? '',
        `UPDATE password_resets SET acknowledged_at = now() WHERE id = '${id}'`,
      );
      expect(update.rowCount, stranger?.name).toBe(0);
    }
    const ack = await asApp(
      vera?.id ?? '',
      `UPDATE password_resets SET acknowledged_at = now() WHERE id = '${id}'`,
    );
    expect(ack.rowCount).toBe(1);
  });

  it('ребёнок меняет только acknowledged_at: другие колонки и чужие поля закрыты правами', async () => {
    const id = await seedReset(true);
    for (const statement of [
      `UPDATE password_resets SET completed_at = NULL WHERE id = '${id}'`,
      `UPDATE password_resets SET requested_by = '${vera?.id}' WHERE id = '${id}'`,
      `UPDATE password_resets SET account_id = '${boris?.id}' WHERE id = '${id}'`,
      `INSERT INTO password_resets (account_id, requested_by, expires_at) VALUES ('${vera?.id}', '${anna?.id}', now())`,
      `DELETE FROM password_resets WHERE id = '${id}'`,
    ]) {
      await reject(asApp(vera?.id ?? '', statement), statement);
    }
  });

  it('невыполненный сброс подтвердить нельзя — отметки ещё нет', async () => {
    const id = await seedReset(false);
    const ack = await asApp(
      vera?.id ?? '',
      `UPDATE password_resets SET acknowledged_at = now() WHERE id = '${id}'`,
    );
    expect(ack.rowCount).toBe(0);
  });

  it('служба входа отмечает сброс выполненным один раз и больше ничего в нём не меняет', async () => {
    const id = await seedReset(false);
    const done = await database.auth.query(
      `UPDATE password_resets SET completed_at = now() WHERE id = $1`,
      [id],
    );
    expect(done.rowCount).toBe(1);
    const again = await database.auth.query(
      `UPDATE password_resets SET completed_at = now() WHERE id = $1`,
      [id],
    );
    expect(again.rowCount).toBe(0);
    for (const statement of [
      `UPDATE password_resets SET acknowledged_at = now() WHERE id = '${id}'`,
      `UPDATE password_resets SET account_id = '${boris?.id}' WHERE id = '${id}'`,
      `DELETE FROM password_resets WHERE id = '${id}'`,
    ]) {
      await expect(database.auth.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
    const reopen = await seedReset(false);
    await expect(
      database.auth.query(`UPDATE password_resets SET completed_at = NULL WHERE id = $1`, [reopen]),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('приглашения', () => {
  const hash = () => randomBytes(24).toString('base64url');

  async function adminInsert(extra = '', values = ''): Promise<unknown> {
    return asApp(
      anna?.id ?? '',
      `INSERT INTO invitations (household_id, role, token_hash, created_by${extra})
       VALUES ('${home?.id}', 'adult', '${hash()}', '${anna?.id}'${values})`,
    );
  }

  it('срок не больше 72 часов: база не даст выдать дольше, что бы ни прислало приложение', async () => {
    await expect(
      adminInsert(', expires_at', `, now() + interval '73 hours'`),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'invitations_ttl' },
    });
    await expect(adminInsert(', expires_at', `, now() - interval '1 hour'`)).rejects.toMatchObject({
      cause: { code: '23514' },
    });
    await adminInsert(', expires_at', `, now() + interval '71 hours'`); // короче можно
    const { rows } = await database.admin.query<{ hours: number }>(
      `SELECT extract(epoch FROM expires_at - created_at) / 3600 AS hours FROM invitations
       WHERE created_by = $1 ORDER BY created_at DESC LIMIT 1`,
      [anna?.id],
    );
    expect(Number(rows[0]?.hours)).toBeCloseTo(71, 0);
    await adminInsert();
    const defaults = await database.admin.query<{ hours: number }>(
      `SELECT extract(epoch FROM expires_at - created_at) / 3600 AS hours FROM invitations
       ORDER BY id DESC LIMIT 1`,
    );
    expect(Number(defaults.rows[0]?.hours)).toBe(72);
  });

  it('приглашение нельзя выдать уже принятым или отозванным и от чужого имени', async () => {
    await reject(adminInsert(', accepted_at, accepted_by', `, now(), '${boris?.id}'`), 'принятое');
    await reject(adminInsert(', revoked_at', ', now()'), 'отозванное');
    await reject(
      asApp(
        anna?.id ?? '',
        `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ('${home?.id}', 'adult', '${hash()}', '${boris?.id}')`,
      ),
      'от имени Бориса',
    );
  });

  it('приложение отзывает только своё непринятое и меняет только revoked_at', async () => {
    const { rows } = await database.admin.query<{ id: string }>(
      `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ($1, 'child', $2, $3) RETURNING id`,
      [home?.id, hash(), anna?.id],
    );
    const id = rows[0]?.id;
    for (const statement of [
      `UPDATE invitations SET role = 'admin' WHERE id = '${id}'`,
      `UPDATE invitations SET token_hash = 'x' WHERE id = '${id}'`,
      `UPDATE invitations SET expires_at = now() + interval '72 hours' WHERE id = '${id}'`,
      `DELETE FROM invitations WHERE id = '${id}'`,
    ]) {
      await reject(asApp(anna?.id ?? '', statement), statement);
    }
    // Борис не администратор: приглашения дома для него невидимы и неотзываемы.
    const foreign = await asApp(
      boris?.id ?? '',
      `UPDATE invitations SET revoked_at = now() WHERE id = '${id}'`,
    );
    expect(foreign.rowCount).toBe(0);
    const revoke = await asApp(
      anna?.id ?? '',
      `UPDATE invitations SET revoked_at = now() WHERE id = '${id}'`,
    );
    expect(revoke.rowCount).toBe(1);
  });

  it('служба входа принимает только живое приглашение: просроченное, отозванное и принятое — нет', async () => {
    const make = async (set: string) => {
      const token = hash();
      await database.admin.query(
        `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ($1, 'adult', $2, $3)`,
        [home?.id, token, anna?.id],
      );
      if (set)
        await database.admin.query(`UPDATE invitations SET ${set} WHERE token_hash = $1`, [token]);
      return token;
    };
    const accept = (token: string) =>
      database.auth.query(
        `UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE token_hash = $1`,
        [token, boris?.id],
      );
    const live = await make('');
    const expired = await make(
      `created_at = created_at - interval '73 hours', expires_at = expires_at - interval '73 hours'`,
    );
    const revoked = await make('revoked_at = now()');
    const used = await make(`accepted_at = now(), accepted_by = '${vera?.id}'`);

    expect((await accept(expired)).rowCount, 'просроченное').toBe(0);
    expect((await accept(revoked)).rowCount, 'отозванное').toBe(0);
    expect((await accept(used)).rowCount, 'принятое').toBe(0);
    expect((await accept(live)).rowCount, 'живое').toBe(1);
    expect((await accept(live)).rowCount, 'второй раз').toBe(0);
  });

  it('служба входа не меняет роль, срок и хэш и не снимает отметку о принятии', async () => {
    const token = hash();
    await database.admin.query(
      `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ($1, 'child', $2, $3)`,
      [home?.id, token, anna?.id],
    );
    for (const statement of [
      `UPDATE invitations SET role = 'admin' WHERE token_hash = '${token}'`,
      `UPDATE invitations SET expires_at = now() + interval '72 hours' WHERE token_hash = '${token}'`,
      `UPDATE invitations SET token_hash = 'x' WHERE token_hash = '${token}'`,
      `UPDATE invitations SET accepted_at = NULL WHERE token_hash = '${token}'`,
      `DELETE FROM invitations WHERE token_hash = '${token}'`,
      `INSERT INTO invitations (household_id, role, token_hash, created_by) VALUES ('${home?.id}', 'admin', 'zzz', '${anna?.id}')`,
    ]) {
      await expect(database.auth.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
  });
});
