// Мост Fastify ↔ Better Auth по настоящему HTTP, а не через inject: тело, заголовки и несколько
// Set-Cookie в одном ответе. Сервер на свободном порту 127.0.0.1 (AGENTS.md: тесты постоянных
// портов не занимают).
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BASE_URL } from '../testing/device.ts';
import { enrollTotp } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let base: string;

beforeAll(async () => {
  world = await createWorld();
  await world.app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(world.app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await world?.close();
});

const JSON_HEADERS = { 'content-type': 'application/json', origin: BASE_URL };

describe('настоящий HTTP', () => {
  it('вход, сессия и выход через сокет', async () => {
    const signIn = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'user-agent': 'RealHttp/1.0' },
      body: JSON.stringify({ username: 'boris', password: world.boris.password }),
    });
    expect(signIn.status).toBe(200);
    const [cookie] = signIn.headers.getSetCookie();
    expect(cookie).toMatch(
      /^__Secure-homecrm\.session_token=.+; Max-Age=7776000; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    const pair = (cookie ?? '').split(';')[0] ?? '';

    const me = await fetch(`${base}/api/me`, { headers: { cookie: pair } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: 'boris', roles: [{ role: 'adult' }] });
    // Адрес клиента берётся из соединения: здесь он петлевой, а не из присланных заголовков.
    const { rows } = await world.database.admin.query(
      `SELECT ip_address, user_agent FROM sessions WHERE user_id = $1`,
      [world.boris.id],
    );
    expect(rows).toEqual([{ ip_address: '127.0.0.1', user_agent: 'RealHttp/1.0' }]);

    const out = await fetch(`${base}/api/auth/sign-out`, {
      method: 'POST',
      headers: { origin: BASE_URL, cookie: pair, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(out.status).toBe(200);
    expect((await fetch(`${base}/api/me`, { headers: { cookie: pair } })).status).toBe(401);
  });

  it('несколько Set-Cookie в одном ответе уходят отдельными заголовками', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    await enrollTotp(device, world.boris);
    const reply = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ username: 'boris', password: world.boris.password }),
    });
    expect(await reply.json()).toMatchObject({ twoFactorRedirect: true });
    const cookies = reply.headers.getSetCookie();
    expect(cookies.length).toBeGreaterThanOrEqual(2);
    expect(cookies.some((cookie) => cookie.startsWith('__Secure-homecrm.two_factor='))).toBe(true);
    expect(
      cookies.some(
        (cookie) =>
          cookie.startsWith('__Secure-homecrm.session_token=;') && cookie.includes('Max-Age=0'),
      ),
    ).toBe(true);
  });

  it('тело неверного формата и пустое тело не роняют сервер', async () => {
    const broken = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{"username": ',
    });
    expect(broken.status).toBe(400);
    const empty = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: JSON_HEADERS,
    });
    expect(empty.status).toBeGreaterThanOrEqual(400);
    expect(empty.status).toBeLessThan(500);
    const form = await fetch(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE_URL },
      body: `username=boris&password=${encodeURIComponent(world.boris.password)}`,
    });
    // Форма, а не JSON: библиотека не должна принимать вход «из формы с чужого сайта» без проверок,
    // а наш мост — пропускать её в обход разбора. Ответ — отказ клиенту, не сбой.
    expect(form.status).toBeLessThan(500);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});
