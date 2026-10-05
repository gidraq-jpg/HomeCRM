// ADR-0005, строка 10: cookie Secure, HttpOnly, SameSite и защита от CSRF (PRD, раздел 13).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device, SetCookie } from '../testing/device.ts';
import { enrollTotp, signInWithTotp } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

const EVIL = 'https://evil.example';

function expectProtected(cookie: SetCookie): void {
  const where = cookie.name;
  expect(cookie.attributes.get('httponly'), where).toBe(true);
  expect(cookie.attributes.get('secure'), where).toBe(true);
  expect(cookie.attributes.get('samesite'), where).toBe('Lax');
  expect(cookie.attributes.get('path'), where).toBe('/');
  // Cookie привязана к хосту: атрибута Domain нет, поддомены её не получают.
  expect(cookie.attributes.has('domain'), where).toBe(false);
  expect(cookie.name, where).toMatch(/^__Secure-homecrm\./);
}

describe('cookie (PRD, раздел 13)', () => {
  it('сессия: Secure, HttpOnly, SameSite=Lax, Path=/, на 90 дней, имя с префиксом __Secure-', async () => {
    const reply = await world.device().signIn('boris', world.boris.password);
    expect(reply.setCookies).toHaveLength(1);
    const [cookie] = reply.setCookies as [SetCookie];
    expect(cookie.name).toBe('__Secure-homecrm.session_token');
    expectProtected(cookie);
    expect(cookie.attributes.get('max-age')).toBe(String(90 * 24 * 60 * 60));
  });

  it('все cookie входа защищены одинаково: второй фактор, доверие к устройству, выход', async () => {
    const anna = world.device();
    await anna.signIn('anna', world.anna.password);
    const enrollment = await enrollTotp(anna, world.anna);
    const seen: SetCookie[] = [];

    const device = world.device();
    const pending = await device.signIn('anna', world.anna.password);
    seen.push(...pending.setCookies);
    await world.clearRateLimits();
    const code = await signInWithTotp(world.device(), world.anna, enrollment);
    seen.push(...code.setCookies);
    const trusted = world.device();
    await world.clearRateLimits();
    await trusted.signIn('anna', world.anna.password);
    await world.clearRateLimits();
    const { currentCode } = await import('../testing/totp.ts');
    seen.push(
      ...(
        await trusted.post('/api/auth/two-factor/verify-totp', {
          code: currentCode(enrollment.uri),
          trustDevice: true,
        })
      ).setCookies,
    );
    seen.push(...(await trusted.post('/api/auth/sign-out')).setCookies);

    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const cookie of seen) expectProtected(cookie);
    const names = new Set(seen.map((cookie) => cookie.name));
    expect(names).toContain('__Secure-homecrm.two_factor');
    expect([...names].some((name) => name.endsWith('trust_device'))).toBe(true);
    // Выход гасит cookie теми же атрибутами.
    const out = seen.filter((cookie) => cookie.attributes.get('max-age') === '0');
    expect(out.length).toBeGreaterThan(0);
  });

  it('токена сессии нет в адресах, а в ответах нет разрешений CORS для чужих сайтов', async () => {
    const device = world.device();
    const reply = await device.signIn('boris', world.boris.password);
    for (const name of ['access-control-allow-origin', 'access-control-allow-credentials']) {
      expect(reply.headers[name], name).toBeUndefined();
    }
    const location = reply.headers.location;
    expect(location).toBeUndefined();
  });
});

describe('защита от CSRF: маршруты библиотеки', () => {
  async function signedIn(): Promise<Device> {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    return device;
  }

  it('изменяющий запрос с cookie и чужим Origin отклонён, сессия цела', async () => {
    const device = await signedIn();
    const reply = await device.post('/api/auth/revoke-sessions', undefined, { origin: EVIL });
    expect(reply.status).toBe(403);
    expect(reply.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
    expect((await device.get('/api/me')).status).toBe(200);
  });

  it('без Origin и Referer запрос с cookie отклонён', async () => {
    const device = await signedIn();
    const reply = await device.post('/api/auth/revoke-sessions', undefined, { origin: null });
    expect(reply.status).toBe(403);
    expect(reply.json()).toMatchObject({ code: 'MISSING_OR_NULL_ORIGIN' });
    expect((await device.get('/api/me')).status).toBe(200);
  });

  it('со своим Origin или своим Referer запрос проходит', async () => {
    const device = await signedIn();
    const withReferer = await device.post('/api/auth/revoke-other-sessions', undefined, {
      origin: null,
      headers: { referer: 'http://homecrm.test/settings' },
    });
    expect(withReferer.status).toBe(200);
    const withOrigin = await device.post('/api/auth/revoke-other-sessions');
    expect(withOrigin.status).toBe(200);
  });

  it('чужой Referer без Origin — тоже отказ', async () => {
    const device = await signedIn();
    const reply = await device.post('/api/auth/revoke-sessions', undefined, {
      origin: null,
      headers: { referer: `${EVIL}/page` },
    });
    expect(reply.status).toBe(403);
  });

  it('вход с чужого сайта (login CSRF): запрос с чужим Origin без cookie отклонён', async () => {
    const reply = await world
      .device()
      .post(
        '/api/auth/sign-in/username',
        { username: 'boris', password: world.boris.password },
        { origin: EVIL },
      );
    expect(reply.status).toBe(403);
    expect(reply.setCookies).toEqual([]);
  });

  it('форма с чужого сайта (Fetch Metadata: cross-site navigate) не входит', async () => {
    const reply = await world.device().post(
      '/api/auth/sign-in/username',
      { username: 'boris', password: world.boris.password },
      {
        origin: null,
        headers: {
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      },
    );
    expect(reply.status).toBe(403);
    expect(reply.setCookies).toEqual([]);
  });

  it('состояние меняют только POST: выход и закрытие сессий через GET не работают', async () => {
    const device = await signedIn();
    for (const url of [
      '/api/auth/sign-out',
      '/api/auth/revoke-sessions',
      '/api/auth/revoke-other-sessions',
    ]) {
      expect((await device.get(url)).status, url).toBe(404);
    }
    expect((await device.get('/api/me')).status).toBe(200);
  });
});

describe('защита от CSRF: маршруты данных (проверка Origin — своя)', () => {
  it('изменяющий запрос с чужим Origin отклонён, до проверки пароля дело не доходит', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    for (const url of ['/api/export', '/api/invitations', '/api/me/password-reset/ack']) {
      const reply = await device.post(url, { password: world.boris.password }, { origin: EVIL });
      expect(reply.status, url).toBe(403);
      expect(reply.json(), url).toMatchObject({ code: 'INVALID_ORIGIN' });
    }
    // Без Origin и Referer — тоже.
    const bare = await device.post(
      '/api/export',
      { password: world.boris.password },
      { origin: null },
    );
    expect(bare.status).toBe(403);
    // Чтение с чужого сайта тоже не получает данные: cookie с SameSite=Lax туда не уходит, а CORS не разрешён.
    expect(
      (await device.get('/api/me', { origin: EVIL })).headers['access-control-allow-origin'],
    ).toBeUndefined();
  });

  it('со своим Origin запрос проходит', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    expect((await device.post('/api/export', { password: world.boris.password })).status).toBe(200);
  });
});
