// Два блокера ревью R0.2: идентификатор входа выбирается по маршруту (AUTH-8),
// действующий код TOTP и параметры запроса не попадают в журнал при отказе базы.
import { createHmac } from 'node:crypto';
import { format } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { enrollTotp } from '../testing/flows.ts';
import { currentCode } from '../testing/totp.ts';
import { createWorld, type World } from '../testing/world.ts';
import { claimTotpCode } from './totp-replay.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

describe('идентификатор входа определяется маршрутом (AUTH-8)', () => {
  it('лишний username не обходит блокировку e-mail, даже с верным паролем', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = await world.device().post('/api/auth/sign-in/email', {
        email: 'boris@family.test',
        password: 'fictional-wrong-password',
      });
      expect(reply.status).toBe(401);
    }
    for (const username of ['unknown-one', 'unknown-two', world.anna.username]) {
      for (const password of ['fictional-wrong-password', world.boris.password]) {
        const reply = await world.device().post('/api/auth/sign-in/email', {
          email: 'boris@family.test',
          username,
          password,
        });
        expect(reply.status).toBe(429);
      }
    }
    expect((await world.device().signIn(world.anna.username, world.anna.password)).status).toBe(
      200,
    );
  });

  it('параллельные смешанные запросы с разных адресов проверяют только пять паролей', async () => {
    const replies = await Promise.all(
      Array.from({ length: 14 }, (_, index) =>
        world.device().post('/api/auth/sign-in/email', {
          email: 'anna@family.test',
          username: `parallel-ghost-${index}`,
          password: 'fictional-wrong-password',
        }),
      ),
    );
    expect(replies.filter((reply) => reply.status === 401)).toHaveLength(5);
    expect(replies.filter((reply) => reply.status === 429)).toHaveLength(9);
    const right = await world.device().post('/api/auth/sign-in/email', {
      email: 'anna@family.test',
      username: 'one-more-ghost',
      password: world.anna.password,
    });
    expect(right.status).toBe(429);
  });

  it('при входе по имени лишний служебный e-mail не учитывается', async () => {
    const device = world.device();
    const reply = await device.post('/api/auth/sign-in/username', {
      username: world.vera.username,
      email: 'ignored@family.invalid',
      password: world.vera.password,
    });
    expect(reply.status).toBe(200);
    expect((await device.get('/api/me')).json().id).toBe(world.vera.id);
  });

  it('успешный вход по e-mail сбрасывает свой счётчик и пишет журнал нужному участнику', async () => {
    await world.database.admin.query('DELETE FROM login_locks WHERE account_id = $1', [
      world.boris.id,
    ]);
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        (
          await world.device().post('/api/auth/sign-in/email', {
            email: 'boris@family.test',
            username: world.vera.username,
            password: 'fictional-wrong-password',
          })
        ).status,
      ).toBe(401);
    }
    const device = world.device();
    const signedIn = await device.post('/api/auth/sign-in/email', {
      email: 'boris@family.test',
      username: world.anna.username,
      password: world.boris.password,
    });
    expect(signedIn.status).toBe(200);
    expect((await device.get('/api/me')).json().id).toBe(world.boris.id);
    const locks = await world.database.admin.query(
      'SELECT 1 FROM login_locks WHERE account_id = $1',
      [world.boris.id],
    );
    expect(locks.rows).toEqual([]);
    const events = (await device.get('/api/login-events')).json<Array<{ outcome: string }>>();
    expect(events[0]?.outcome).toBe('success');
    expect((await world.device().signIn(world.anna.username, world.anna.password)).status).toBe(
      429,
    );
  });
});

describe('отметки TOTP и журнал при сбое записи', () => {
  it('в базе только HMAC; одинаковый код разных участников независим, параллельный повтор закрыт', async () => {
    const code = '385741';
    const replies = await Promise.all(
      Array.from({ length: 2 }, () =>
        claimTotpCode(world.module.db, world.vera.id, code, world.secret),
      ),
    );
    expect(replies.sort()).toEqual([false, true]);
    expect(await claimTotpCode(world.module.db, world.anna.id, code, world.secret)).toBe(true);
    const stored = await world.database.admin.query<{ identifier: string }>(
      "SELECT identifier FROM verifications WHERE identifier LIKE 'totp-used:%'",
    );
    expect(stored.rows).toHaveLength(2);
    for (const row of stored.rows) {
      expect(row.identifier).toMatch(/^totp-used:[A-Za-z0-9_-]{43}$/);
      expect(row.identifier.includes(code)).toBe(false);
    }
  });

  it('живой маркер двух предыдущих шагов закрывает повтор; просроченный не мешает', async () => {
    const code = '385742';
    const clock = await world.database.admin.query<{ step: string }>(
      'SELECT floor(extract(epoch FROM now()) / 30)::bigint AS step',
    );
    // Код может подходить от предыдущего до следующего шага: имитируем его раннее использование.
    const identifier = `totp-used:${createHmac('sha256', world.secret)
      .update(JSON.stringify(['totp-used', world.vera.id, Number(clock.rows[0]?.step) - 2, code]))
      .digest('base64url')}`;
    await world.database.admin.query(
      "INSERT INTO verifications (identifier, value, expires_at) VALUES ($1, '1', now() + interval '1 minute')",
      [identifier],
    );
    expect(await claimTotpCode(world.module.db, world.vera.id, code, world.secret)).toBe(false);
    await world.database.admin.query(
      "UPDATE verifications SET expires_at = now() - interval '1 second' WHERE identifier = $1",
      [identifier],
    );
    expect(await claimTotpCode(world.module.db, world.vera.id, code, world.secret)).toBe(true);
  });

  it('вход остаётся закрыт, в журналах нет кода и SQL-параметров, после восстановления код работает', async () => {
    await world.database.admin.query('DELETE FROM login_locks WHERE account_id = $1', [
      world.boris.id,
    ]);
    const enrolled = world.device();
    await enrolled.signIn(world.boris.username, world.boris.password);
    const enrollment = await enrollTotp(enrolled, world.boris);
    const pending = world.device({ keepUsedCodes: true });
    expect((await pending.signIn(world.boris.username, world.boris.password)).status).toBe(200);
    await world.database.admin.query(
      "DELETE FROM verifications WHERE identifier LIKE 'totp-used:%'",
    );
    await world.database.admin.query(
      "ALTER TABLE verifications ADD CONSTRAINT review_reject_totp CHECK (identifier NOT LIKE 'totp-used:%')",
    );
    world.logs.length = 0;
    world.requestLog.length = 0;
    const consoleLog: string[] = [];
    const errorLog = vi.spyOn(console, 'error').mockImplementation((...args) => {
      consoleLog.push(format(...args));
    });
    const code = currentCode(enrollment.uri);
    try {
      const reply = await pending.post('/api/auth/two-factor/verify-totp', { code });
      expect(reply.status).toBe(500);
      expect((await pending.get('/api/me')).status).toBe(401);
      const logs = [...world.logs, ...world.requestLog, ...consoleLog].join('\n');
      expect(logs.length).toBeGreaterThan(0);
      // Проверяем булевы значения: даже при провале тест не печатает секреты из журналов.
      expect(logs.includes(code)).toBe(false);
      expect(logs.includes('Failed query')).toBe(false);
      expect(logs.includes('TOTP replay protection')).toBe(true);
    } finally {
      errorLog.mockRestore();
      await world.database.admin.query(
        'ALTER TABLE verifications DROP CONSTRAINT review_reject_totp',
      );
    }
    expect((await pending.post('/api/auth/two-factor/verify-totp', { code })).status).toBe(200);
  });
});
