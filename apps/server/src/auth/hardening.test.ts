// Пункты бэклога «К R0.2» и подключение входа (R0.2): блокировка без гонки (AUTH-8), блокировка не
// выдаёт существование имени, очистка просроченного обработчиком, первая настройка (SPACE-2),
// настройки без утечки секретов.
import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadAuthConfig } from '../config.ts';
import { createWorld, type World } from '../testing/world.ts';
import { cleanupExpired } from './cleanup.ts';
import { FirstSetupError, runFirstSetup } from './first-setup.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

describe('блокировка без гонки (AUTH-8)', () => {
  it('параллельная пачка неверных паролей с разных адресов проверяет не больше пяти', async () => {
    const devices = Array.from({ length: 14 }, () => world.device());
    const replies = await Promise.all(
      devices.map((device) => device.signIn(world.boris.username, 'не-тот-пароль-вообще')),
    );
    const statuses = replies.map((reply) => reply.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(9);
    // Верный пароль во время блокировки тоже не пускает.
    const right = await world.device().signIn(world.boris.username, world.boris.password);
    expect(right.status).toBe(429);
  });
});

describe('блокировка не выдаёт, существует ли имя', () => {
  it('имя, которого нет, блокируется так же и в те же сроки', async () => {
    const ghost = 'нет-такого-имени';
    const outcomes: Array<{ status: number; code: unknown }> = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      const reply = await world.device().signIn(ghost, 'какой-то-пароль-1');
      outcomes.push({ status: reply.status, code: reply.json().code });
    }
    expect(outcomes.map((outcome) => outcome.status)).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect(outcomes[5]?.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');

    // Существующее имя ведёт себя так же: те же статусы, тот же код.
    const known: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      known.push((await world.device().signIn(world.vera.username, 'не-тот-пароль-вера')).status);
    }
    expect(known).toEqual([401, 401, 401, 401, 401, 429, 429]);
    // В базе имя не хранится открытым: ключ — хэш.
    const rows = await world.database.admin.query('SELECT name_hash FROM login_name_attempts');
    expect(JSON.stringify(rows.rows)).not.toContain(ghost);
  });
});

describe('очистка просроченного обработчиком', () => {
  it('убирает просроченные сессии и старые счётчики, живое не трогает; пароли обработчику не видны', async () => {
    const { anna } = world;
    await world.database.admin.query(
      `INSERT INTO sessions (user_id, token, expires_at) VALUES
         ($1, 'cleanup-expired', now() - interval '1 day'), ($1, 'cleanup-alive', now() + interval '1 day')`,
      [anna.id],
    );
    await world.database.admin.query(
      `INSERT INTO login_name_attempts (name_hash, failures, window_started_at, locked_until)
       VALUES ('cleanup-old', 5, now() - interval '2 hours', now() - interval '1 hour'),
              ('cleanup-locked', 5, now() - interval '2 minutes', now() + interval '10 minutes')`,
    );
    const report = await cleanupExpired(createWorkerDatabase(world.database.worker));
    expect(Object.keys(report).sort()).toEqual(
      [
        'invitations',
        'login_events',
        'login_locks',
        'login_name_attempts',
        'password_resets',
        'rate_limits',
        'reassigned',
        'sessions',
        'verifications',
      ].sort(),
    );
    const sessions = await world.database.admin.query<{ token: string }>(
      `SELECT token FROM sessions WHERE token LIKE 'cleanup-%'`,
    );
    expect(sessions.rows).toEqual([{ token: 'cleanup-alive' }]);
    const names = await world.database.admin.query<{ name_hash: string }>(
      `SELECT name_hash FROM login_name_attempts WHERE name_hash LIKE 'cleanup-%'`,
    );
    expect(names.rows).toEqual([{ name_hash: 'cleanup-locked' }]);
    await expect(
      world.database.worker.query('SELECT password FROM credentials'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('настройки входа (R0.2)', () => {
  const valid = {
    DATABASE_URL_APP: 'postgres://homecrm_app:app-pw-1234@db/homecrm',
    DATABASE_URL_AUTH: 'postgres://homecrm_auth:auth-pw-1234@db/homecrm',
    DATABASE_URL_WORKER: 'postgres://homecrm_worker:worker-pw-1234@db/homecrm',
    BETTER_AUTH_SECRET: 'x'.repeat(40),
    BASE_URL: 'https://home.example/',
    TRUSTED_ORIGINS: 'http://127.0.0.1:5173, https://m.home.example',
  };

  it('читает три подключения, секрет и адрес', () => {
    expect(loadAuthConfig(valid)).toMatchObject({
      BASE_URL: 'https://home.example',
      TRUSTED_ORIGINS: ['http://127.0.0.1:5173', 'https://m.home.example'],
      HOME_TIME_ZONE: 'Asia/Yekaterinburg',
    });
    expect(loadAuthConfig({ ...valid, HOME_TIME_ZONE: 'Europe/Moscow' }).HOME_TIME_ZONE).toBe(
      'Europe/Moscow',
    );
    expect(() => loadAuthConfig({ ...valid, HOME_TIME_ZONE: 'Mars/Olympus' })).toThrow(
      /HOME_TIME_ZONE/,
    );
  });

  it('ошибка называет переменные, но не значения: ни паролей из адресов, ни секрета', () => {
    const broken = {
      ...valid,
      DATABASE_URL_AUTH: 'mysql://homecrm_auth:leaky-password-77@db/homecrm',
      BETTER_AUTH_SECRET: 'short-secret-leak',
      DATABASE_URL_WORKER: undefined,
    };
    let message = '';
    try {
      loadAuthConfig(broken);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL_AUTH');
    expect(message).toContain('BETTER_AUTH_SECRET');
    expect(message).toContain('DATABASE_URL_WORKER');
    expect(message).not.toContain('leaky-password-77');
    expect(message).not.toContain('short-secret-leak');
  });
});

describe('первая настройка (SPACE-2, S1)', () => {
  it('создаёт дом и администратора под ролью службы входа; повторно отказывается', async () => {
    const fresh = await createWorld({ empty: true });
    try {
      const input = {
        householdName: 'Квартира на Лесной',
        username: 'Хозяйка',
        displayName: 'Мария',
        password: 'fictional-pass-2026',
      };
      // Под ролью службы входа, как в рабочем окружении: политики 0004 пускают первого администратора пустого дома.
      const created = await runFirstSetup(fresh.module.db, input);
      const { rows } = await fresh.database.admin.query(
        `SELECT m.role, s.kind, s.name FROM space_members m JOIN spaces s ON s.id = m.space_id
         WHERE m.account_id = $1`,
        [created.accountId],
      );
      expect(rows).toEqual([{ role: 'admin', kind: 'household', name: 'Квартира на Лесной' }]);
      // Пароль в базе — только хэш Argon2id.
      const stored = await fresh.database.admin.query<{ password: string }>(
        'SELECT password FROM credentials WHERE user_id = $1',
        [created.accountId],
      );
      expect(stored.rows[0]?.password).toMatch(/^\$argon2id\$/);
      expect(JSON.stringify(stored.rows)).not.toContain(input.password);
      // Войти можно, пока без второго фактора управление закрыто (AUTH-3).
      const device = fresh.device();
      expect((await device.signIn('хозяйка', input.password)).status).toBe(200);
      const me = await device.get('/api/me');
      expect(me.json()).toMatchObject({ secondFactorRequired: true });

      await expect(runFirstSetup(fresh.module.db, input)).rejects.toMatchObject({
        code: 'ALREADY_SET_UP',
      });
      await expect(
        runFirstSetup(fresh.module.db, { ...input, password: 'short' }),
      ).rejects.toBeInstanceOf(FirstSetupError);
    } finally {
      await fresh.close();
    }
  });
});
