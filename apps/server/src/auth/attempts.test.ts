// ADR-0005, строка 9: ограничение попыток с временной блокировкой и журнал входов (AUTH-8).
// Два уровня: библиотека ограничивает запросы по адресу и пути, а блокировку по учётной записи —
// против подбора с разных адресов — делаем сами (attempts.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enrollTotp } from '../testing/flows.ts';
import { currentCode } from '../testing/totp.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

const WRONG = 'совсем-другой-пароль-1';

interface LockRow {
  failures: number;
  locked_until: Date | null;
}
const lockOf = async (accountId: string): Promise<LockRow | undefined> =>
  (
    await world.database.admin.query<LockRow>(
      'SELECT failures, locked_until FROM login_locks WHERE account_id = $1',
      [accountId],
    )
  ).rows[0];

describe('ограничение запросов по адресу (библиотека)', () => {
  it('после 20 входов с одного адреса за 15 минут — отказ с временем ожидания; чужой адрес не страдает', async () => {
    const ip = '198.51.100.60';
    for (let attempt = 0; attempt < 20; attempt++) {
      // Имена несуществующие: блокировка учётной записи тут не при чём, проверяем лимит адреса.
      const reply = await world.device({ ip }).signIn(`nobody${attempt}`, WRONG);
      expect(reply.status, `попытка ${attempt + 1}`).toBe(401);
    }
    const blocked = await world.device({ ip }).signIn('nobody-more', WRONG);
    expect(blocked.status).toBe(429);
    const wait = Number(blocked.headers['x-retry-after']);
    expect(wait).toBeGreaterThan(800);
    expect(wait).toBeLessThanOrEqual(900);

    // Другой адрес и другой путь не затронуты.
    expect(
      (await world.device({ ip: '198.51.100.61' }).signIn('boris', world.boris.password)).status,
    ).toBe(200);
    expect((await world.device({ ip }).get('/api/me')).status).toBe(401);

    // Счётчик лежит в базе и переживёт перезапуск; время переведено на 15 минут вперёд.
    const { rows } = await world.database.admin.query(
      `SELECT count FROM rate_limits WHERE key = $1`,
      [`${ip}|/sign-in/username`],
    );
    expect(rows).toEqual([{ count: 20 }]);
    await world.database.admin.query(`UPDATE rate_limits SET last_request = last_request - 901000`);
    expect((await world.device({ ip }).signIn('boris', world.boris.password)).status).toBe(200);
  });

  it('заголовками адрес не подменить: лимит считается по адресу соединения', async () => {
    const ip = '198.51.100.62';
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 22; attempt++) {
      const device = world.device({ ip });
      const reply = await device.post(
        '/api/auth/sign-in/username',
        { username: `ghost${attempt}`, password: WRONG },
        {
          headers: {
            'x-forwarded-for': `203.0.113.${attempt}`,
            'x-homecrm-client-ip': `203.0.113.${attempt}`,
          },
        },
      );
      statuses.push(reply.status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});

describe('блокировка по учётной записи (своя)', () => {
  it('пять неверных паролей с разных адресов блокируют вход на 15 минут, даже с верным паролем', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const reply = await world.device().signIn('vera', `${WRONG}-${attempt}`);
      expect(reply.status, `попытка ${attempt + 1}`).toBe(401);
    }
    expect(await lockOf(world.vera.id)).toMatchObject({ failures: 5 });
    const locked = await world.device().signIn('vera', world.vera.password);
    expect(locked.status).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    const retry = Number(locked.headers['retry-after']);
    expect(retry).toBeGreaterThan(800);
    expect(retry).toBeLessThanOrEqual(900);
    expect(locked.setCookies).toEqual([]);

    // Блокировка касается только этой учётной записи.
    expect((await world.device().signIn('boris', world.boris.password)).status).toBe(200);
    // Попытки во время блокировки её не продлевают.
    const until = (await lockOf(world.vera.id))?.locked_until?.getTime();
    await world.device().signIn('vera', WRONG);
    expect((await lockOf(world.vera.id))?.locked_until?.getTime()).toBe(until);

    // Время переведено: блокировка и окно счётчика давно вышли.
    await world.database.admin.query(
      `UPDATE login_locks SET locked_until = now() - interval '1 second', window_started_at = now() - interval '1 hour' WHERE account_id = $1`,
      [world.vera.id],
    );
    expect((await world.device().signIn('vera', world.vera.password)).status).toBe(200);
    expect(await lockOf(world.vera.id)).toBeUndefined();
  });

  it('верный пароль обнуляет счётчик: четыре неудачи, вход, ещё четыре — блокировки нет', async () => {
    for (let attempt = 0; attempt < 4; attempt++) await world.device().signIn('boris', WRONG);
    expect(await lockOf(world.boris.id)).toMatchObject({ failures: 4 });
    expect((await world.device().signIn('boris', world.boris.password)).status).toBe(200);
    expect(await lockOf(world.boris.id)).toBeUndefined();
    for (let attempt = 0; attempt < 4; attempt++) await world.device().signIn('boris', WRONG);
    expect((await world.device().signIn('boris', world.boris.password)).status).toBe(200);
  });

  it('неудачи старше окна счётчик не наращивают', async () => {
    await world.device().signIn('boris', WRONG);
    await world.database.admin.query(
      `UPDATE login_locks SET window_started_at = now() - interval '16 minutes', failures = 4 WHERE account_id = $1`,
      [world.boris.id],
    );
    await world.device().signIn('boris', WRONG);
    expect(await lockOf(world.boris.id)).toMatchObject({ failures: 1 });
    await world.device().signIn('boris', world.boris.password);
  });
});

describe('журнал входов (AUTH-8)', () => {
  it('участник видит свои входы с устройством, адресом и итогом — и только свои', async () => {
    await world.database.admin.query('DELETE FROM login_events');
    const device = world.device({ userAgent: 'Vera-Tablet/9', ip: '198.51.100.70' });
    await device.signIn('vera', WRONG);
    await device.signIn('vera', world.vera.password);
    const intruder = world.device({ userAgent: 'Unknown-Browser/1', ip: '203.0.113.99' });
    await intruder.signIn('vera', WRONG);

    const events = (await device.get('/api/login-events')).json<
      Array<{
        kind: string;
        outcome: string;
        ipAddress: string;
        userAgent: string;
        createdAt: string;
      }>
    >();
    expect(events.map((event) => `${event.outcome}:${event.userAgent}:${event.ipAddress}`)).toEqual(
      [
        'failure:Unknown-Browser/1:203.0.113.99',
        'success:Vera-Tablet/9:198.51.100.70',
        'failure:Vera-Tablet/9:198.51.100.70',
      ],
    );
    expect(events.every((event) => event.kind === 'sign_in')).toBe(true);

    // У Бориса и администратора в журнале нет чужих входов: их защищает RLS, а не фильтр в коде.
    const boris = world.device();
    await boris.signIn('boris', world.boris.password);
    const borisEvents = (await boris.get('/api/login-events')).json<Array<{ userAgent: string }>>();
    expect(borisEvents).toHaveLength(1);
    expect(borisEvents[0]?.userAgent).not.toBe('Vera-Tablet/9');
    const total = await world.database.admin.query('SELECT count(*)::int AS n FROM login_events');
    expect(total.rows[0]?.n).toBeGreaterThan(borisEvents.length);
  });

  it('блокировка и второй фактор тоже попадают в журнал', async () => {
    await world.database.admin.query('DELETE FROM login_events; DELETE FROM login_locks;');
    const anna = world.device({ userAgent: 'Anna-Laptop/1' });
    await anna.signIn('anna', world.anna.password);
    const enrollment = await enrollTotp(anna, world.anna);

    const second = world.device({ userAgent: 'Anna-Phone/2' });
    await second.signIn('anna', world.anna.password); // пароль верен, код ещё нужен
    await world.clearRateLimits();
    await second.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    await world.clearRateLimits();
    await second.post('/api/auth/two-factor/verify-totp', { code: currentCode(enrollment.uri) });

    const events = (await anna.get('/api/login-events')).json<
      Array<{ kind: string; outcome: string; userAgent: string }>
    >();
    const summary = events.map((event) => `${event.kind}:${event.outcome}:${event.userAgent}`);
    expect(summary).toContain('sign_in:second_factor_required:Anna-Phone/2');
    expect(summary).toContain('second_factor:failure:Anna-Phone/2');
    expect(summary).toContain('second_factor:success:Anna-Phone/2');
    expect(summary).toContain('sign_in:success:Anna-Laptop/1');

    // Вход в заблокированную запись тоже виден владельцу.
    for (let attempt = 0; attempt < 5; attempt++) await world.device().signIn('anna', WRONG);
    await world.device().signIn('anna', world.anna.password);
    const after = (await anna.get('/api/login-events')).json<Array<{ outcome: string }>>();
    expect(after.filter((event) => event.outcome === 'failure').length).toBeGreaterThanOrEqual(5);
    expect(after.some((event) => event.outcome === 'locked')).toBe(true);
  });
});
