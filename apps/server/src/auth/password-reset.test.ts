// ADR-0005, строка 6: сброс пароля — администратор только ребёнку, ребёнок видит отметку о сбросе
// (AUTH-5); восстановление по e-mail работает, если на сервере настроена почта (AUTH-4).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { enrollTotp, signedInAdmin } from '../testing/flows.ts';
import { currentCode } from '../testing/totp.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let admin: Device;

beforeAll(async () => {
  world = await createWorld({ mail: true });
  ({ device: admin } = await signedInAdmin(world));
});

afterAll(async () => {
  await world?.close();
});

interface ResetLink {
  url: string;
  token: string;
  expiresAt: string;
}

async function issueLink(): Promise<ResetLink> {
  const reply = await admin.post('/api/auth/homecrm/child-reset-link', {
    accountId: world.vera.id,
  });
  expect(reply.status, reply.text).toBe(200);
  return reply.json<ResetLink>();
}

const newPassword = () => `vera-new-${randomUUID().slice(0, 8)}`;

describe('администратор сбрасывает пароль ребёнку (AUTH-5)', () => {
  it('ссылка на сутки; ребёнок задаёт новый пароль; старый и все сессии перестают работать', async () => {
    const sessionA = world.device();
    const sessionB = world.device();
    await sessionA.signIn(world.vera.username, world.vera.password);
    await sessionB.signIn(world.vera.username, world.vera.password);

    const link = await issueLink();
    expect(link.url).toBe(`http://homecrm.test/reset-password?token=${link.token}`);
    const hours = (Date.parse(link.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
    const pending = await world.database.admin.query(
      'SELECT requested_by, completed_at, acknowledged_at FROM password_resets WHERE account_id = $1',
      [world.vera.id],
    );
    expect(pending.rows).toEqual([
      { requested_by: world.anna.id, completed_at: null, acknowledged_at: null },
    ]);

    // Ребёнок открывает ссылку на своём устройстве: входить для этого не нужно.
    const password = newPassword();
    const set = await world
      .device()
      .post('/api/auth/reset-password', { token: link.token, newPassword: password });
    expect(set.status, set.text).toBe(200);

    expect((await world.device().signIn(world.vera.username, world.vera.password)).status).toBe(
      401,
    );
    expect((await world.device().signIn(world.vera.username, password)).status).toBe(200);
    // Сессии, открытые со старым паролем, закрыты на всех устройствах.
    expect((await sessionA.get('/api/me')).status).toBe(401);
    expect((await sessionB.get('/api/me')).status).toBe(401);

    // Ссылка одноразовая.
    const again = await world
      .device()
      .post('/api/auth/reset-password', { token: link.token, newPassword: newPassword() });
    expect(again.status).toBe(400);
    expect(again.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    world.vera.password = password;
  });

  it('при следующем входе ребёнок видит отметку о сбросе, пока не подтвердит, что прочитал', async () => {
    const device = world.device();
    await device.signIn(world.vera.username, world.vera.password);
    const me = (await device.get('/api/me')).json<{
      passwordReset: { completedAt: string } | null;
    }>();
    expect(me.passwordReset?.completedAt).toBeTruthy();
    expect(Date.now() - Date.parse(me.passwordReset?.completedAt ?? '')).toBeLessThan(60_000);

    // Отметка видна на каждом устройстве ребёнка, а у других её нет.
    const second = world.device();
    await second.signIn(world.vera.username, world.vera.password);
    expect((await second.get('/api/me')).json()).toMatchObject({
      passwordReset: { completedAt: me.passwordReset?.completedAt },
    });
    expect((await admin.get('/api/me')).json()).toMatchObject({ passwordReset: null });

    expect((await device.post('/api/me/password-reset/ack')).json()).toEqual({ acknowledged: 1 });
    expect((await device.get('/api/me')).json()).toMatchObject({ passwordReset: null });
    expect((await device.post('/api/me/password-reset/ack')).json()).toEqual({ acknowledged: 0 });

    // В журнале входов ребёнка — запись о смене пароля по ссылке.
    const events = (await device.get('/api/login-events')).json<
      Array<{ kind: string; outcome: string }>
    >();
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'password_reset', outcome: 'success' }),
    );
  });

  it('короткий пароль отклоняется и ссылку не тратит; просроченная ссылка не работает', async () => {
    const link = await issueLink();
    const device = world.device();
    const short = await device.post('/api/auth/reset-password', {
      token: link.token,
      newPassword: '123456789',
    });
    expect(short.status).toBe(400);
    expect(short.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });

    // Срок вышел: время переведено на минуту после окончания.
    await world.database.admin.query(
      `UPDATE verifications SET expires_at = now() - interval '1 minute' WHERE identifier = $1`,
      [`reset-password:${link.token}`],
    );
    const late = await device.post('/api/auth/reset-password', {
      token: link.token,
      newPassword: newPassword(),
    });
    expect(late.status).toBe(400);
    expect(late.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    expect((await world.device().signIn(world.vera.username, world.vera.password)).status).toBe(
      200,
    );
  });

  it('действует только последняя выданная ссылка: прежние отзываются', async () => {
    const first = await issueLink();
    const second = await issueLink();
    expect(second.token).not.toBe(first.token);
    const stale = await world
      .device()
      .post('/api/auth/reset-password', { token: first.token, newPassword: newPassword() });
    expect(stale.status).toBe(400);
    expect(stale.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    const password = newPassword();
    const fresh = await world
      .device()
      .post('/api/auth/reset-password', { token: second.token, newPassword: password });
    expect(fresh.status, fresh.text).toBe(200);
    world.vera.password = password;
  });

  it('второй фактор ребёнка не сбрасывается: войти по новому паролю без кода нельзя', async () => {
    const vera = world.device();
    await vera.signIn(world.vera.username, world.vera.password);
    const enrollment = await enrollTotp(vera, world.vera);

    const link = await issueLink();
    const password = newPassword();
    await world
      .device()
      .post('/api/auth/reset-password', { token: link.token, newPassword: password });
    world.vera.password = password;

    // Даже тот, кто знает ссылку и новый пароль, упирается во второй фактор.
    const intruder = world.device();
    const first = await intruder.signIn(world.vera.username, password);
    expect(first.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await intruder.get('/api/me')).status).toBe(401);
    // Владелец телефона с приложением входит.
    const owner = world.device();
    await world.clearRateLimits();
    await owner.signIn(world.vera.username, password);
    await world.clearRateLimits();
    expect(
      (await owner.post('/api/auth/two-factor/verify-totp', { code: currentCode(enrollment.uri) }))
        .status,
    ).toBe(200);
    // Для следующих тестов у ребёнка снова нет второго фактора.
    await world.clearRateLimits();
    await owner.post('/api/auth/two-factor/disable', { password });
  });
});

describe('кому администратор не сбрасывает пароль (AUTH-5)', () => {
  it('взрослому, себе, чужому и несуществующему — отказ; взрослый и ребёнок не сбрасывают никому', async () => {
    const before = await world.database.admin.query(
      'SELECT count(*)::int AS n FROM password_resets',
    );
    const refusals: Array<[string, Device, string]> = [
      ['администратор → взрослый', admin, world.boris.id],
      ['администратор → он сам', admin, world.anna.id],
      ['администратор → несуществующий', admin, randomUUID()],
    ];
    const boris = world.device();
    await boris.signIn(world.boris.username, world.boris.password);
    refusals.push(['взрослый → ребёнок', boris, world.vera.id]);
    const vera = world.device();
    await vera.signIn(world.vera.username, world.vera.password);
    refusals.push(['ребёнок → администратор', vera, world.anna.id]);

    for (const [title, device, accountId] of refusals) {
      const reply = await device.post('/api/auth/homecrm/child-reset-link', { accountId });
      expect(reply.status, title).toBe(403);
      expect(reply.json(), title).toMatchObject({ code: 'RESET_NOT_ALLOWED' });
    }
    // Без входа и с чужим телом.
    expect(
      (
        await world
          .device()
          .post('/api/auth/homecrm/child-reset-link', { accountId: world.vera.id })
      ).status,
    ).toBe(401);
    expect(
      (await admin.post('/api/auth/homecrm/child-reset-link', { accountId: 'not-a-uuid' })).status,
    ).toBe(400);

    const after = await world.database.admin.query(
      'SELECT count(*)::int AS n FROM password_resets',
    );
    expect(after.rows).toEqual(before.rows);
  });
});

describe('восстановление по e-mail (AUTH-4)', () => {
  it('при настроенной почте взрослый получает письмо со ссылкой и меняет пароль', async () => {
    const boris = world.device();
    const other = world.device();
    await other.signIn(world.boris.username, world.boris.password);
    world.mailbox.length = 0;

    const requested = await boris.post('/api/auth/request-password-reset', {
      email: 'boris@family.test',
      redirectTo: '/reset-password',
    });
    expect(requested.status).toBe(200);
    expect(world.mailbox).toHaveLength(1);
    expect(world.mailbox[0]?.to).toBe('boris@family.test');
    const url = new URL(/(https?:\/\/\S+)/.exec(world.mailbox[0]?.text ?? '')?.[1] ?? '');

    // Ссылка из письма: сервер проверяет её и перенаправляет на страницу сброса с токеном.
    const visit = await world
      .device()
      .request('GET', `${url.pathname}${url.search}`, { origin: null });
    expect(visit.status).toBe(302);
    const location = new URL(String(visit.headers.location), 'http://homecrm.test');
    expect(location.pathname).toBe('/reset-password');
    const token = location.searchParams.get('token') ?? '';
    expect(token).not.toBe('');

    const password = `boris-new-${randomUUID().slice(0, 8)}`;
    expect(
      (await boris.post('/api/auth/reset-password', { token, newPassword: password })).status,
    ).toBe(200);
    expect((await world.device().signIn(world.boris.username, password)).status).toBe(200);
    expect((await other.get('/api/me')).status).toBe(401); // старые сессии закрыты
    // Отметки администратора нет: сброс сделал сам владелец почты.
    const me = world.device();
    await me.signIn(world.boris.username, password);
    expect((await me.get('/api/me')).json()).toMatchObject({ passwordReset: null });
  });

  it('ребёнку без почты и неизвестному адресу письма не уходят, ответ один и тот же', async () => {
    const { rows } = await world.database.admin.query<{ email: string }>(
      'SELECT email FROM accounts WHERE id = $1',
      [world.vera.id],
    );
    world.mailbox.length = 0;
    const replies = [];
    for (const email of [rows[0]?.email ?? '', 'nobody@family.test']) {
      replies.push(
        await world
          .device()
          .post('/api/auth/request-password-reset', { email, redirectTo: '/reset-password' }),
      );
    }
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    expect(replies[0]?.text).toBe(replies[1]?.text);
    expect(world.mailbox).toEqual([]);
  });

  it('без настроенной почты восстановление по e-mail выключено', async () => {
    const bare = await createWorld();
    try {
      const reply = await bare.device().post('/api/auth/request-password-reset', {
        email: 'boris@family.test',
        redirectTo: '/reset-password',
      });
      expect(reply.status).toBe(400);
      expect(reply.json()).toMatchObject({ code: 'RESET_PASSWORD_DISABLED' });
    } finally {
      await bare.close();
    }
  });
});
