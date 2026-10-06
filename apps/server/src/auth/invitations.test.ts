// ADR-0005, строка 3: приглашения с ролью, одноразовые, на 72 часа; открытой регистрации нет (AUTH-2).
import { createHash, randomBytes } from 'node:crypto';
import { invitations } from '@homecrm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { acceptInvitation, invite, signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let admin: Device;

beforeAll(async () => {
  world = await createWorld();
  ({ device: admin } = await signedInAdmin(world));
});

afterAll(async () => {
  await world?.close();
});

const PASSWORD = 'new-member-pass-77';
let counter = 0;
const nextName = () => `guest${++counter}`;

async function row(token: string) {
  const hash = createHash('sha256').update(token).digest('base64url');
  const { rows } = await world.database.admin.query(
    'SELECT * FROM invitations WHERE token_hash = $1',
    [hash],
  );
  return rows[0];
}

describe('выдача приглашения', () => {
  it('администратор выдаёт ссылку с ролью на 72 часа; в базе только хэш ссылки', async () => {
    const created = await invite(admin, world, 'adult');
    expect(created.url).toBe(`http://homecrm.test/invite/${created.token}`);
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await row(created.token);
    expect(stored).toMatchObject({
      role: 'adult',
      household_id: world.houseId,
      created_by: world.anna.id,
    });
    expect(stored.token_hash).not.toContain(created.token);
    const hours = (stored.expires_at.getTime() - stored.created_at.getTime()) / 3_600_000;
    expect(hours).toBe(72);
    // Ссылку нельзя достать из базы никак, кроме перебора 256 бит.
    const dump = await world.database.admin.query<{ dump: string }>(
      `SELECT string_agg(i::text, ' ') AS dump FROM invitations i`,
    );
    expect(dump.rows[0]?.dump).not.toContain(created.token);
  });

  it('приглашать может только администратор дома: взрослый и ребёнок получают отказ', async () => {
    for (const person of [world.boris, world.vera]) {
      const device = world.device();
      await device.signIn(person.username, person.password);
      const reply = await device.post('/api/invitations', {
        householdId: world.houseId,
        role: 'child',
      });
      expect(reply.status, person.username).toBe(403);
    }
    const nobody = await world
      .device()
      .post('/api/invitations', { householdId: world.houseId, role: 'child' });
    expect(nobody.status).toBe(401);
    // И база не пропустит, даже если в коде проверку забыли: политика invitations_insert.
    for (const person of [world.boris, world.vera]) {
      await expect(
        world.module.appDb.withAccount(person.id, (tx) =>
          tx.insert(invitations).values({
            householdId: world.houseId,
            role: 'child',
            tokenHash: randomBytes(32).toString('base64url'),
            createdBy: person.id,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });
    }
  });
});

describe('принятие приглашения', () => {
  it('человек получает учётную запись с ролью из приглашения, личное пространство и сессию', async () => {
    for (const role of ['adult', 'child', 'admin'] as const) {
      const link = await invite(admin, world, role);
      const newcomer = world.device({ ip: '198.51.100.7' });
      const username = nextName();
      const reply = await acceptInvitation(newcomer, {
        token: link.token,
        username,
        displayName: `Гость ${username}`,
        password: PASSWORD,
      });
      expect(reply.status, reply.text).toBe(200);
      const created = reply.json<{ id: string; role: string; householdId: string }>();
      expect(created).toMatchObject({ username, role, householdId: world.houseId });

      // Сессия уже есть: человек вошёл.
      const me = (await newcomer.get('/api/me')).json<{ roles: Array<{ role: string }> }>();
      expect(me.roles).toEqual([{ householdId: world.houseId, role }]);

      // Членство, личное пространство (SPACE-1) и пароль — в базе; приглашение отмечено принятым.
      const { rows } = await world.database.admin.query(
        `SELECT m.role, s.kind, s.owner_account_id, c.provider_id, i.accepted_by
         FROM space_members m
         JOIN spaces s ON s.owner_account_id = m.account_id
         JOIN credentials c ON c.user_id = m.account_id
         JOIN invitations i ON i.accepted_by = m.account_id
         WHERE m.account_id = $1`,
        [created.id],
      );
      expect(rows).toEqual([
        {
          role,
          kind: 'personal',
          owner_account_id: created.id,
          provider_id: 'credential',
          accepted_by: created.id,
        },
      ]);
      // Новый участник может войти заново своим паролем.
      expect((await world.device().signIn(username, PASSWORD)).status).toBe(200);
    }
  });

  it('приглашение одноразовое: по второму разу — отказ, второй учётной записи нет', async () => {
    const link = await invite(admin, world, 'adult');
    const first = await acceptInvitation(world.device(), {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(first.status).toBe(200);
    const accounts = (await world.database.admin.query('SELECT count(*)::int AS n FROM accounts'))
      .rows[0].n;
    const second = await acceptInvitation(world.device(), {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(second.status).toBe(410);
    expect(second.json()).toMatchObject({ code: 'INVITATION_USED' });
    expect(
      (await world.database.admin.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n,
    ).toBe(accounts);
  });

  it('через 72 часа приглашение не принимается', async () => {
    const link = await invite(admin, world, 'adult');
    // Время переведено: приглашение создано 73 часа назад, срок вышел час назад.
    await world.database.admin.query(
      `UPDATE invitations SET created_at = created_at - interval '73 hours',
         expires_at = expires_at - interval '73 hours' WHERE id = $1`,
      [link.id],
    );
    const reply = await acceptInvitation(world.device(), {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(reply.status).toBe(410);
    expect(reply.json()).toMatchObject({ code: 'INVITATION_EXPIRED' });
    expect((await row(link.token)).accepted_at).toBeNull();
  });

  it('за минуту до конца срока приглашение ещё принимается', async () => {
    const link = await invite(admin, world, 'adult');
    await world.database.admin.query(
      `UPDATE invitations SET created_at = created_at - interval '71 hours 59 minutes',
         expires_at = expires_at - interval '71 hours 59 minutes' WHERE id = $1`,
      [link.id],
    );
    const reply = await acceptInvitation(world.device(), {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(reply.status, reply.text).toBe(200);
  });

  it('отозванное приглашение не принимается', async () => {
    const link = await invite(admin, world, 'child');
    const revoked = await admin.post(`/api/invitations/${link.id}/revoke`);
    expect(revoked.status).toBe(200);
    const reply = await acceptInvitation(world.device(), {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(reply.status).toBe(410);
    expect(reply.json()).toMatchObject({ code: 'INVITATION_REVOKED' });
    // Повторный отзыв — «не найдено», а не второй отзыв.
    expect((await admin.post(`/api/invitations/${link.id}/revoke`)).status).toBe(404);
  });

  it('неизвестная и искажённая ссылки отклоняются; в ответе нет ничего о других приглашениях', async () => {
    const unknown = await acceptInvitation(world.device(), {
      token: randomBytes(32).toString('base64url'),
      username: nextName(),
      password: PASSWORD,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json()).toMatchObject({ code: 'INVITATION_NOT_FOUND' });
    for (const token of ['', 'short', 'x'.repeat(44), `${'a'.repeat(42)}!`]) {
      const reply = await acceptInvitation(world.device(), {
        token,
        username: nextName(),
        password: PASSWORD,
      });
      expect(reply.status, token).toBe(400);
    }
  });

  it('занятое имя, короткий пароль и служебный адрес не расходуют приглашение', async () => {
    const link = await invite(admin, world, 'adult');
    const device = world.device();
    const taken = await acceptInvitation(device, {
      token: link.token,
      username: 'Vera',
      password: PASSWORD,
    });
    expect(taken.status).toBe(409);
    expect(taken.json()).toMatchObject({ code: 'USERNAME_ALREADY_TAKEN' });
    const short = await acceptInvitation(device, {
      token: link.token,
      username: nextName(),
      password: '123456789',
    });
    expect(short.status).toBe(400);
    expect(short.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    const badName = await acceptInvitation(device, {
      token: link.token,
      username: 'a b',
      password: PASSWORD,
    });
    expect(badName.status).toBe(400);
    const placeholder = await acceptInvitation(device, {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
      email: 'x@no-email.homecrm.invalid',
    });
    expect(placeholder.status).toBe(400);
    const takenEmail = await acceptInvitation(device, {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
      email: 'boris@family.test',
    });
    expect(takenEmail.status).toBe(409);
    expect(takenEmail.json()).toMatchObject({ code: 'EMAIL_ALREADY_TAKEN' });

    expect((await row(link.token)).accepted_at).toBeNull();
    // Ни одной «осиротевшей» записи от неудачных попыток: транзакция откатилась целиком.
    const orphans = await world.database.admin.query(
      `SELECT a.id FROM accounts a LEFT JOIN credentials c ON c.user_id = a.id
       LEFT JOIN spaces s ON s.owner_account_id = a.id WHERE c.id IS NULL OR s.id IS NULL`,
    );
    expect(orphans.rows).toEqual([]);
    // Исправившись, человек принимает то же приглашение.
    const fixed = await acceptInvitation(device, {
      token: link.token,
      username: nextName(),
      password: PASSWORD,
    });
    expect(fixed.status).toBe(200);
  });

  it('при настоящей почте она сохраняется, без неё — служебный адрес', async () => {
    const withMail = await invite(admin, world, 'adult');
    const username = nextName();
    expect(
      (
        await acceptInvitation(world.device(), {
          token: withMail.token,
          username,
          password: PASSWORD,
          email: 'Guest.Mail@Example.test',
        })
      ).status,
    ).toBe(200);
    const { rows } = await world.database.admin.query(
      'SELECT email FROM accounts WHERE username = $1',
      [username],
    );
    expect(rows).toEqual([{ email: 'guest.mail@example.test' }]);
  });

  it('шесть человек одновременно по одной ссылке: принимает один', async () => {
    const link = await invite(admin, world, 'adult');
    const before = (await world.database.admin.query('SELECT count(*)::int AS n FROM accounts'))
      .rows[0].n;
    const replies = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        acceptInvitation(world.device({ ip: `198.51.100.${20 + index}` }), {
          token: link.token,
          username: nextName(),
          password: PASSWORD,
        }),
      ),
    );
    expect(replies.filter((reply) => reply.status === 200)).toHaveLength(1);
    expect(replies.filter((reply) => reply.status === 410)).toHaveLength(5);
    const after = (await world.database.admin.query('SELECT count(*)::int AS n FROM accounts'))
      .rows[0].n;
    expect(after).toBe(before + 1);
  });
});
