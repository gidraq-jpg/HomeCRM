// R0.2c: защита собственных маршрутов сессий и контракт хэширования адаптера.
import { randomUUID } from 'node:crypto';
import {
  accounts,
  credentials,
  rateLimits,
  sessions,
  twoFactors,
  verifications,
} from '@homecrm/db';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { BASE_URL, type Device, type RequestOptions } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';
import { hashSessionToken, sessionTokenAdapter } from './auth.ts';

let world: World;
beforeAll(async () => {
  world = await createWorld();
});
afterAll(async () => {
  await world?.close();
});
beforeEach(async () => {
  await world.clearRateLimits();
});

const ROUTES = [
  { method: 'GET', path: '/api/auth/list-sessions', status: 200 },
  { method: 'POST', path: '/api/auth/revoke-session', status: 404 },
  { method: 'POST', path: '/api/auth/revoke-other-sessions', status: 200 },
] as const;
const currentId = async (device: Device): Promise<string> => {
  const list = (await device.get('/api/auth/list-sessions')).json<
    Array<{ id: string; current: boolean }>
  >();
  const current = list.find((row) => row.current);
  if (current === undefined) throw new Error('Missing current test session');
  return current.id;
};

describe('лимит 120 запросов в минуту по адресу и пути (AUTH-8)', () => {
  it.each(ROUTES)(
    '$path: 121-й запрос получает 429; кодирование пути, query и поддельный IP не обходят лимит',
    async ({ method, path, status }) => {
      const device = world.device();
      await device.signIn('boris', world.boris.password);
      const id = randomUUID();
      const paths = [
        path,
        path.replace('session', '%73ession'),
        path.replace('list-session', 'l%69st-%73ession'),
        path.replace('/auth/', '/%61uth/'),
      ];
      for (let attempt = 0; attempt < 120; attempt++) {
        const response = await device.request(
          method,
          `${paths[attempt % paths.length]}?attempt=${attempt}`,
          {
            ...(method === 'POST' ? { json: { id } } : {}),
            headers: {
              'x-homecrm-client-ip': `203.0.113.${attempt}`,
              'x-forwarded-for': `203.0.113.${attempt}`,
            },
          },
        );
        expect(response.status, String(attempt)).toBe(status);
      }
      const blocked = await device.request(method, path, { json: { id } });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
      expect(blocked.headers['cache-control']).toBe('no-store');
      const counters = await world.database.admin.query(
        'SELECT key, count FROM rate_limits WHERE key LIKE $1',
        [`session:${device.ip}:%`],
      );
      expect(counters.rows).toEqual([{ key: `session:${device.ip}:${path}`, count: 120 }]);
      // Другой адрес и другой путь имеют собственные счётчики.
      expect((await world.device().request(method, path, { json: { id } })).status).toBe(401);
      const other = path === ROUTES[0].path ? ROUTES[2] : ROUTES[0];
      expect((await device.request(other.method, other.path)).status).toBe(200);
    },
  );

  it('запросы без сессии тоже считаются', async () => {
    const device = world.device();
    for (let attempt = 0; attempt < 120; attempt++)
      expect((await device.get(ROUTES[0].path)).status).toBe(401);
    expect((await device.get(ROUTES[0].path)).status).toBe(429);
  });

  it('параллельная пачка на границе пропускает ровно один запрос', async () => {
    const device = world.device();
    await device.get(ROUTES[0].path);
    await world.database.admin.query('UPDATE rate_limits SET count = 119');
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => device.get(ROUTES[0].path)),
    );
    expect(responses.filter((response) => response.status === 401)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(11);
  });

  it('после минуты от последнего разрешённого запроса счётчик начинается заново', async () => {
    const device = world.device();
    await device.get(ROUTES[0].path);
    await world.database.admin.query('UPDATE rate_limits SET count = 120, last_request = $1', [
      Date.now() - 59_000,
    ]);
    expect((await device.get(ROUTES[0].path)).status).toBe(429);
    await world.database.admin.query('UPDATE rate_limits SET last_request = $1', [
      Date.now() - 60_001,
    ]);
    expect((await device.get(ROUTES[0].path)).status).toBe(401);
    const { rows } = await world.database.admin.query('SELECT count FROM rate_limits');
    expect(rows).toEqual([{ count: 1 }]);
  });

  it('пересоздание приложения не снимает ограничение', async () => {
    const device = world.device();
    await device.get(ROUTES[0].path);
    await world.database.admin.query('UPDATE rate_limits SET count = 120');
    const app = buildApp({ LOG_LEVEL: 'silent', APP_VERSION: 'test' }, { auth: world.module });
    try {
      const response = await app.inject({
        method: 'GET',
        url: ROUTES[0].path,
        remoteAddress: device.ip,
      });
      expect(response.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('Origin, Referer и Fetch Metadata — общее правило с плагином', () => {
  it.each(ROUTES)(
    '$path: чужой источник и cross-site navigate отклоняются до отзыва',
    async ({ method, path }) => {
      const device = world.device();
      await device.signIn('boris', world.boris.password);
      const id = await currentId(device);
      const sources: RequestOptions[] = [
        { origin: 'https://foreign.test' },
        { origin: 'null' },
        { origin: null, headers: { referer: 'https://foreign.test/settings' } },
        { origin: null, headers: { referer: 'invalid-url' } },
        { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } },
        {
          origin: null,
          headers: {
            referer: `${BASE_URL}/settings`,
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
          },
        },
      ];
      const counters = () =>
        world.database.admin.query(
          'SELECT key, count FROM rate_limits WHERE key LIKE $1 ORDER BY key',
          [`session:${device.ip}:%`],
        );
      const before = (await counters()).rows;
      for (const options of sources) {
        const response = await device.request(method, path, {
          ...options,
          ...(method === 'POST' ? { json: { id } } : {}),
        });
        expect(response.status).toBe(403);
      }
      expect((await counters()).rows).toEqual(before);
      await world.database.admin.query('UPDATE rate_limits SET count = 120 WHERE key LIKE $1', [
        `session:${device.ip}:%`,
      ]);
      expect((await device.request(method, path, { origin: 'https://foreign.test' })).status).toBe(
        403,
      );
      expect((await device.get('/api/me')).status).toBe(200);
    },
  );

  it.each(ROUTES)(
    '$path: свой Referer и обычный Fetch Metadata разрешены',
    async ({ method, path, status }) => {
      const device = world.device();
      await device.signIn('boris', world.boris.password);
      const response = await device.request(method, path, {
        origin: null,
        headers: {
          referer: `${BASE_URL}/settings`,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
        },
        ...(method === 'POST' ? { json: { id: randomUUID() } } : {}),
      });
      expect(response.status).toBe(status);
      const missing = await device.request(method, path, {
        origin: null,
        json: { id: randomUUID() },
      });
      expect(missing.status).toBe(method === 'GET' ? 200 : 403);
    },
  );

  it('HEAD списка сессий без Origin остаётся безопасным чтением, чужой Origin отклонён', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const cookie = [...device.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const response = await world.app.inject({
      method: 'HEAD',
      url: ROUTES[0].path,
      remoteAddress: device.ip,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    const foreign = await world.app.inject({
      method: 'HEAD',
      url: ROUTES[0].path,
      remoteAddress: device.ip,
      headers: { cookie, origin: 'https://foreign.test' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('плагин применяет то же правило к Referer без cookie', async () => {
    const response = await world.device().post(
      '/api/auth/sign-in/username',
      { username: 'boris', password: world.boris.password },
      {
        origin: null,
        headers: { referer: 'https://foreign.test/login' },
      },
    );
    expect(response.status).toBe(403);
    expect(response.setCookies).toEqual([]);
  });
});

describe('отзыв текущей сессии по id (AUTH-6)', () => {
  it('гасит cookie как обычный выход, включая ответ при продлении старой сессии', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const id = await currentId(device);
    await world.database.admin.query(
      "UPDATE sessions SET updated_at = now() - interval '2 days' WHERE id = $1",
      [id],
    );
    const response = await device.post('/api/auth/revoke-session', { id });
    expect(response.status).toBe(200);
    expect(device.cookies.size).toBe(0);
    expect((await device.get('/api/me')).status).toBe(401);
    const ordinary = world.device();
    await ordinary.signIn('boris', world.boris.password);
    const signedOut = await ordinary.post('/api/auth/sign-out');
    expect(
      response.setCookies.map((cookie) => [cookie.name, cookie.value, [...cookie.attributes]]),
    ).toEqual(
      signedOut.setCookies.map((cookie) => [cookie.name, cookie.value, [...cookie.attributes]]),
    );
  });

  it('отзыв другого устройства оставляет cookie текущего и не пишет токены в журналы', async () => {
    const device = world.device();
    const other = world.device();
    await device.signIn('boris', world.boris.password);
    await other.signIn('boris', world.boris.password);
    const cookies = [...device.cookies.values(), ...other.cookies.values()];
    const tokens = cookies.map((cookie) => decodeURIComponent(cookie).split('.')[0] ?? '');
    const response = await device.post('/api/auth/revoke-session', { id: await currentId(other) });
    expect(response.status).toBe(200);
    expect(response.setCookies).toEqual([]);
    expect((await device.get('/api/me')).status).toBe(200);
    expect((await other.get('/api/me')).status).toBe(401);
    const logs = [...world.logs, ...world.requestLog].join('\n');
    for (const secret of [...cookies, ...tokens, ...tokens.map(hashSessionToken), world.secret])
      expect(logs).not.toContain(secret);
  });
});

describe('набор методов адаптера Better Auth при обновлении (PRD раздел 13)', () => {
  it('каждый метод данных фактического Drizzle-адаптера заменён обёрткой хэширования', async () => {
    const { options } = world.module.auth;
    const raw = drizzleAdapter(world.module.db, {
      provider: 'pg',
      transaction: true,
      schema: { accounts, sessions, credentials, verifications, twoFactors, rateLimits },
    })(options);
    const original = { ...raw };
    const wrapped = sessionTokenAdapter(raw);
    // Метаданные и DDL не работают со строками сессий; transaction отдельно проверен ниже.
    const exceptions = new Set(['id', 'options', 'createSchema', 'transaction']);
    const checked = Object.entries(original).filter(([name]) => !exceptions.has(name));
    expect(checked.length).toBeGreaterThan(0);
    for (const [name, method] of checked) {
      expect(typeof method, name).toBe('function');
      expect(Reflect.get(wrapped, name), name).not.toBe(method);
    }
    await (await world.module.auth.$context).adapter.transaction(async (tx) => {
      expect(
        Object.keys(tx)
          .filter((name) => !exceptions.has(name))
          .sort(),
      ).toEqual(checked.map(([name]) => name).sort());
    });
  });

  it('по id и userId адаптер возвращает только хэш, по токену — исходное значение', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const token =
      decodeURIComponent(device.cookies.get('__Secure-homecrm.session_token') ?? '').split(
        '.',
      )[0] ?? '';
    const { adapter } = await world.module.auth.$context;
    const byToken = await adapter.findOne<{ id: string; token: string }>({
      model: 'session',
      where: [{ field: 'token', value: token }],
    });
    const byId = await adapter.findOne<{ token: string }>({
      model: 'session',
      where: [{ field: 'id', value: byToken?.id ?? '' }],
    });
    const byUser = await adapter.findMany<{ token: string }>({
      model: 'session',
      where: [{ field: 'userId', value: world.boris.id }],
    });
    expect(byToken?.token).toBe(token);
    expect(byId?.token).toBe(hashSessionToken(token));
    expect(byUser.every((row) => /^h1:[0-9a-f]{64}$/.test(row.token))).toBe(true);
  });
});

describe('ответы API не кэшируются (PRD раздел 13)', () => {
  it('заголовок есть у данных, ответов Better Auth, 401, 403, 400 и 404', async () => {
    const device = world.device();
    const responses = [await device.get('/api/me')];
    responses.push(await device.signIn('boris', world.boris.password));
    responses.push(await device.get('/api/me'));
    responses.push(await device.get('/api/notes'));
    responses.push(await device.get('/api/auth/get-session'));
    responses.push(await device.post('/api/auth/revoke-session', { id: 'invalid' }));
    responses.push(
      await device.post('/api/auth/revoke-other-sessions', {}, { origin: 'https://foreign.test' }),
    );
    responses.push(await device.get('/api/unknown'));
    expect(responses.map((response) => response.status)).toEqual([
      401, 200, 200, 200, 200, 400, 403, 404,
    ]);
    for (const response of responses) expect(response.headers['cache-control']).toBe('no-store');
  });
});
