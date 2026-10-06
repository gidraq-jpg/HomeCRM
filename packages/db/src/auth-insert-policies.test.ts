// Политики вставки службы входа (миграция 0004; бэклог «К R0.2»): роль нового участника связана
// с приглашением в самой базе, а не только в коде сервера. Новый участник дома появляется
// только по приглашению, принятому в этой же транзакции, с тем же домом и той же ролью, либо как
// первый администратор пустого дома (SPACE-2). Обработчик убирает только просроченное.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let database: TestDatabase;
let scene: Scene;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(database);
});

afterAll(async () => {
  await database?.drop();
});

type Statement = [text: string, values?: unknown[]];

/** Транзакция службы входа (роль homecrm_auth): так сервер принимает приглашение. */
async function asAuth(statements: Statement[]): Promise<void> {
  const client = await database.auth.connect();
  try {
    await client.query('BEGIN');
    for (const [text, values] of statements) await client.query(text, values);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function invite(
  role: 'admin' | 'adult' | 'child',
  options: { revoked?: boolean; accepted?: boolean } = {},
): Promise<string> {
  const home = scene.family.houses[0];
  if (home === undefined) throw new Error('No house');
  const { rows } = await database.admin.query<{ id: string }>(
    `INSERT INTO invitations (household_id, role, token_hash, created_by, revoked_at)
     VALUES ($1, $2, $3, $4, ${options.revoked ? 'now()' : 'NULL'}) RETURNING id`,
    [home.id, role, randomUUID(), scene.person('anna').id],
  );
  return rows[0]?.id ?? '';
}

/** Учётная запись с личным пространством, приглашением и членством — как acceptInvitation. */
function acceptance(
  accountId: string,
  invitationId: string,
  role: string,
  houseId = scene.family.houses[0]?.id ?? '',
): Statement[] {
  return [
    [
      'INSERT INTO accounts (id, display_name, email, username) VALUES ($1, $2, $3, $4)',
      [accountId, 'Новичок', `${accountId}@family.invalid`, accountId],
    ],
    [
      `INSERT INTO spaces (kind, name, owner_account_id) VALUES ('personal', 'Личное: Новичок', $1)`,
      [accountId],
    ],
    [
      'UPDATE invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
      [invitationId, accountId],
    ],
    [
      'INSERT INTO space_members (space_id, account_id, role) VALUES ($3, $1, $2)',
      [accountId, role, houseId],
    ],
  ];
}

const denied = { code: '42501' };

describe('новый участник дома: роль связана с приглашением', () => {
  it('по принятому приглашению с той же ролью — принимается', async () => {
    const id = randomUUID();
    await asAuth(acceptance(id, await invite('child'), 'child'));
    const { rows } = await database.admin.query(
      'SELECT role FROM space_members WHERE account_id = $1',
      [id],
    );
    expect(rows).toEqual([{ role: 'child' }]);
  });

  it('с ролью выше приглашённой — отказ: администратором по приглашению ребёнка не стать', async () => {
    const id = randomUUID();
    const invitation = await invite('child');
    await expect(asAuth(acceptance(id, invitation, 'admin'))).rejects.toMatchObject(denied);
    await expect(asAuth(acceptance(id, invitation, 'adult'))).rejects.toMatchObject(denied);
  });

  it('в другой дом, чем в приглашении, — отказ', async () => {
    const neighbours = scene.family.houses[1]?.id ?? '';
    const id = randomUUID();
    await expect(
      asAuth(acceptance(id, await invite('adult'), 'adult', neighbours)),
    ).rejects.toMatchObject(denied);
  });

  it('без приглашения в дом, где уже есть участники, — отказ, какую бы роль ни назвали', async () => {
    const id = randomUUID();
    const [account, space] = acceptance(id, '', 'child');
    const house = scene.family.houses[0]?.id ?? '';
    for (const role of ['admin', 'adult', 'child']) {
      await expect(
        asAuth([
          account ?? ['SELECT 1'],
          space ?? ['SELECT 1'],
          [
            'INSERT INTO space_members (space_id, account_id, role) VALUES ($1, $2, $3)',
            [house, id, role],
          ],
        ]),
        role,
      ).rejects.toMatchObject(denied);
    }
  });

  it('приглашение, принятое в другой транзакции, роли не даёт', async () => {
    const id = randomUUID();
    const invitation = await invite('adult');
    await asAuth(acceptance(randomUUID(), invitation, 'adult'));
    // Ни отметить принятое повторно, ни сослаться на него в новой транзакции нельзя.
    await expect(asAuth(acceptance(id, invitation, 'adult'))).rejects.toMatchObject(denied);
  });

  it('отозванное приглашение принять нельзя', async () => {
    const id = randomUUID();
    const invitation = await invite('adult', { revoked: true });
    await expect(asAuth(acceptance(id, invitation, 'adult'))).rejects.toMatchObject(denied);
  });

  it('первый участник пустого дома — только администратор; дальше — по приглашению', async () => {
    const { rows } = await database.admin.query<{ id: string }>(
      `INSERT INTO spaces (kind, name) VALUES ('household', 'Новый дом') RETURNING id`,
    );
    const house = rows[0]?.id ?? '';
    const account = (id: string): Statement[] => [
      [
        'INSERT INTO accounts (id, display_name, email, username) VALUES ($1, $2, $3, $4)',
        [id, 'Первый', `${id}@family.invalid`, id],
      ],
      [
        `INSERT INTO spaces (kind, name, owner_account_id) VALUES ('personal', 'Личное: Первый', $1)`,
        [id],
      ],
    ];
    const join = (id: string, role: string): Statement => [
      'INSERT INTO space_members (space_id, account_id, role) VALUES ($1, $2, $3)',
      [house, id, role],
    ];
    const adult = randomUUID();
    await expect(asAuth([...account(adult), join(adult, 'adult')])).rejects.toMatchObject(denied);
    const admin = randomUUID();
    await asAuth([...account(admin), join(admin, 'admin')]);
    // Второй администратор без приглашения: дом уже не пуст.
    const second = randomUUID();
    await expect(asAuth([...account(second), join(second, 'admin')])).rejects.toMatchObject(denied);
  });

  it('личное пространство — только учётной записи, созданной в этой же транзакции', async () => {
    const boris = scene.person('boris');
    await expect(
      database.auth.query(
        `INSERT INTO spaces (kind, name, owner_account_id) VALUES ('personal', 'Второе', $1)`,
        [boris.id],
      ),
    ).rejects.toMatchObject(denied);
  });
});

describe('обработчик убирает только просроченное', () => {
  it('просроченные сессии и одноразовые значения — да, живые — нет', async () => {
    const anna = scene.person('anna');
    await database.admin.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES
         ($1, 'expired', now() - interval '1 day'), ($1, 'alive', now() + interval '1 day')`,
      [anna.id],
    );
    await database.admin.query(
      `INSERT INTO verifications (identifier, value, expires_at) VALUES
         ('old', 'v', now() - interval '1 minute'), ('new', 'v', now() + interval '1 hour')`,
    );
    // Без условия: что удалить, решает политика, а не запрос.
    const sessions = await database.worker.query('DELETE FROM sessions');
    const verifications = await database.worker.query('DELETE FROM verifications');
    expect(sessions.rowCount).toBe(1);
    expect(verifications.rowCount).toBe(1);
    const left = await database.admin.query('SELECT token FROM sessions');
    expect(left.rows).toEqual([{ token: 'alive' }]);
  });

  it('приглашения и журнал — только старше срока хранения; пароли и участников обработчик не видит', async () => {
    const anna = scene.person('anna');
    const home = scene.family.houses[0]?.id ?? '';
    await database.admin.query(
      `INSERT INTO invitations (household_id, role, token_hash, created_by, accepted_at, accepted_by, created_at, expires_at)
       VALUES ($1, 'adult', 'old-accepted', $2, now() - interval '31 days', $2, now() - interval '33 days', now() - interval '30 days'),
              ($1, 'adult', 'recent-accepted', $2, now() - interval '1 day', $2, now() - interval '2 days', now() - interval '1 day')`,
      [home, anna.id],
    );
    await database.admin.query(
      `INSERT INTO login_events (account_id, kind, outcome, created_at) VALUES
         ($1, 'sign_in', 'success', now() - interval '200 days'), ($1, 'sign_in', 'success', now())`,
      [anna.id],
    );
    const invitations = await database.worker.query('DELETE FROM invitations');
    const events = await database.worker.query('DELETE FROM login_events');
    expect(invitations.rowCount).toBe(1);
    expect(events.rowCount).toBe(1);
    for (const table of ['credentials', 'two_factors', 'accounts']) {
      await expect(database.worker.query(`SELECT * FROM ${table}`)).rejects.toMatchObject(denied);
    }
  });
});
