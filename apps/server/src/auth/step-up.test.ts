// ADR-0005, строка 8: смена пароля, второго фактора и экспорт требуют повторного ввода пароля (AUTH-7).
// Сессии самой по себе мало: тот, кто унёс устройство с открытой сессией, пароля не знает.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrollTotp } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
  // Личное Бориса, личное Анны и общая заметка дома: экспорт должен отдать только положенное.
  await world.database.admin.query(
    `INSERT INTO notes (space_id, space_kind, audience, author_id, title) VALUES
       ($1, 'personal', NULL, $2, 'Личная заметка Бориса'),
       ($3, 'personal', NULL, $4, 'Личная заметка Анны'),
       ($5, 'household', 'household', $4, 'Общая заметка дома')`,
    [
      world.boris.personalSpaceId,
      world.boris.id,
      world.anna.personalSpaceId,
      world.anna.id,
      world.houseId,
    ],
  );
});

afterAll(async () => {
  await world?.close();
});

describe('смена пароля', () => {
  it('требует текущий пароль: сессия без него ничего не меняет', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const noPassword = await device.post('/api/auth/change-password', {
      newPassword: 'brand-new-pass-1',
    });
    expect(noPassword.status).toBe(400);
    const wrong = await device.post('/api/auth/change-password', {
      currentPassword: 'не-тот-пароль-совсем',
      newPassword: 'brand-new-pass-1',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json()).toMatchObject({ code: 'INVALID_PASSWORD' });
    // Пароль прежний.
    expect((await world.device().signIn('boris', world.boris.password)).status).toBe(200);
    expect((await world.device().signIn('boris', 'brand-new-pass-1')).status).toBe(401);
  });

  it('с верным текущим паролем меняется и закрывает остальные устройства, а текущее оставляет', async () => {
    const phone = world.device();
    const laptop = world.device();
    await phone.signIn('boris', world.boris.password);
    await laptop.signIn('boris', world.boris.password);
    const changed = await phone.post('/api/auth/change-password', {
      currentPassword: world.boris.password,
      newPassword: 'brand-new-pass-1',
      revokeOtherSessions: true,
    });
    expect(changed.status, changed.text).toBe(200);
    world.boris.password = 'brand-new-pass-1';
    expect((await world.device().signIn('boris', 'boris-pass-5822-ok')).status).toBe(401);
    expect((await world.device().signIn('boris', 'brand-new-pass-1')).status).toBe(200);
    expect((await laptop.get('/api/me')).status).toBe(401);
    expect((await phone.get('/api/me')).status).toBe(200);
  });

  it('неверные пароли при смене копятся в блокировку, как и при входе', async () => {
    const device = world.device({ ip: '198.51.100.50' });
    await device.signIn('boris', world.boris.password);
    for (let attempt = 0; attempt < 5; attempt++) {
      await world.clearRateLimits();
      const wrong = await device.post('/api/auth/change-password', {
        currentPassword: `wrong-password-${attempt}`,
        newPassword: 'another-new-pass-1',
      });
      expect(wrong.status, `попытка ${attempt + 1}`).toBe(400);
    }
    await world.clearRateLimits();
    const locked = await device.post('/api/auth/change-password', {
      currentPassword: world.boris.password,
      newPassword: 'another-new-pass-1',
    });
    expect(locked.status).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    // Блокировка временная: после срока пароль снова подтверждается.
    await world.database.admin.query(
      `UPDATE login_locks SET locked_until = now() - interval '1 second', window_started_at = now() - interval '1 hour'
       WHERE account_id = $1`,
      [world.boris.id],
    );
    await world.clearRateLimits();
    const ok = await device.post('/api/auth/change-password', {
      currentPassword: world.boris.password,
      newPassword: 'another-new-pass-1',
    });
    expect(ok.status, ok.text).toBe(200);
    world.boris.password = 'another-new-pass-1';
  });
});

describe('второй фактор', () => {
  it('ссылка для приложения и новые коды восстановления выдаются только за пароль', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const enrollment = await enrollTotp(device, world.boris);
    await world.clearRateLimits();

    expect((await device.post('/api/auth/two-factor/get-totp-uri', {})).status).toBe(400);
    const wrong = await device.post('/api/auth/two-factor/get-totp-uri', {
      password: 'не-тот-пароль-совсем',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json()).toMatchObject({ code: 'INVALID_PASSWORD' });
    await world.clearRateLimits();
    const ok = await device.post('/api/auth/two-factor/get-totp-uri', {
      password: world.boris.password,
    });
    expect(ok.status).toBe(200);
    expect(ok.json<{ totpURI: string }>().totpURI).toBe(enrollment.uri);

    // Выключение — тоже за пароль (подробнее — в two-factor.test.ts).
    await world.clearRateLimits();
    expect((await device.post('/api/auth/two-factor/disable', {})).status).toBe(400);
    expect(
      (await device.post('/api/auth/two-factor/disable', { password: 'не-тот-пароль-совсем' }))
        .status,
    ).toBe(400);
    await world.clearRateLimits();
    expect(
      (await device.post('/api/auth/two-factor/disable', { password: world.boris.password }))
        .status,
    ).toBe(200);
  });
});

describe('экспорт', () => {
  it('без пароля и с неверным паролем не выдаётся', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const none = await device.post('/api/export', {});
    expect(none.status).toBe(400);
    expect(none.json()).toMatchObject({ code: 'PASSWORD_REQUIRED' });
    const wrong = await device.post('/api/export', { password: 'не-тот-пароль-совсем' });
    expect(wrong.status).toBe(403);
    expect(wrong.json()).toMatchObject({ code: 'INVALID_PASSWORD' });
    expect(wrong.text).not.toContain('Личная заметка');
  });

  it('с верным паролем отдаёт только то, что участнику положено видеть', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const reply = await device.post('/api/export', { password: world.boris.password });
    expect(reply.status, reply.text).toBe(200);
    const body = reply.json<{
      profile: { displayName: string };
      notes: Array<{ title: string }>;
    }>();
    expect(body.profile.displayName).toBe('Борис');
    expect(body.notes.map((note) => note.title).sort()).toEqual(['Личная заметка Бориса']);
  });

  it('неверные пароли при экспорте копятся в блокировку', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await device.post('/api/export', { password: `wrong-${attempt}-pass` })).status).toBe(
        403,
      );
    }
    const locked = await device.post('/api/export', { password: world.boris.password });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
    await world.database.admin.query(`DELETE FROM login_locks WHERE account_id = $1`, [
      world.boris.id,
    ]);
    expect((await device.post('/api/export', { password: world.boris.password })).status).toBe(200);
  });
});
