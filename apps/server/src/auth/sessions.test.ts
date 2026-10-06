// ADR-0005, строка 7: сессии до 90 дней с продлением, список устройств, «Выйти на всех
// устройствах» (AUTH-6). Время не ждём: сроки в базе переводятся напрямую.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

const NINETY_DAYS = 90 * 24 * 60 * 60;

interface SessionRow {
  token: string;
  expires_at: Date;
  updated_at: Date;
  created_at: Date;
  ip_address: string | null;
  user_agent: string | null;
}

async function sessionsOf(userId: string): Promise<SessionRow[]> {
  const { rows } = await world.database.admin.query<SessionRow>(
    'SELECT token, expires_at, updated_at, created_at, ip_address, user_agent FROM sessions WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows;
}

const tokenOf = (device: Device): string =>
  decodeURIComponent(device.cookies.get('__Secure-homecrm.session_token') ?? '').split('.')[0] ??
  '';

describe('срок сессии (AUTH-6)', () => {
  it('сессия живёт 90 дней: и в базе, и в cookie', async () => {
    const device = world.device();
    const reply = await device.signIn('boris', world.boris.password);
    const cookie = reply.setCookies.find((item) => item.name === '__Secure-homecrm.session_token');
    expect(cookie?.attributes.get('max-age')).toBe(String(NINETY_DAYS));
    const [session] = (await sessionsOf(world.boris.id)).slice(-1);
    const seconds = ((session?.expires_at.getTime() ?? 0) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(NINETY_DAYS - 60);
    expect(seconds).toBeLessThanOrEqual(NINETY_DAYS);
  });

  it('свежая сессия не продлевается на каждый запрос', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const before = (await sessionsOf(world.boris.id)).slice(-1)[0];
    const reply = await device.get('/api/me');
    expect(reply.status).toBe(200);
    expect(reply.setCookies).toEqual([]);
    const after = (await sessionsOf(world.boris.id)).slice(-1)[0];
    expect(after?.expires_at).toEqual(before?.expires_at);
  });

  it('при использовании сессия продлевается до 90 дней от сегодняшнего дня — и запись, и cookie', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const token = tokenOf(device);
    // Прошло два дня: до конца осталось 88 дней, обновлялась сессия сутки назад.
    await world.database.admin.query(
      `UPDATE sessions SET updated_at = now() - interval '2 days', expires_at = now() + interval '88 days' WHERE token = $1`,
      [token],
    );
    // Запрос к данным (не к библиотеке): cookie с новым сроком должна дойти до клиента и отсюда.
    const reply = await device.get('/api/me');
    expect(reply.status).toBe(200);
    const refreshed = reply.setCookies.find(
      (item) => item.name === '__Secure-homecrm.session_token',
    );
    expect(refreshed?.attributes.get('max-age')).toBe(String(NINETY_DAYS));
    const { rows } = await world.database.admin.query<SessionRow>(
      'SELECT expires_at FROM sessions WHERE token = $1',
      [token],
    );
    const seconds = ((rows[0]?.expires_at.getTime() ?? 0) - Date.now()) / 1000;
    expect(seconds).toBeGreaterThan(NINETY_DAYS - 60);
    expect(seconds).toBeLessThanOrEqual(NINETY_DAYS);
  });

  it('дольше 90 дней сессия не живёт: просроченная отвергается и удаляется', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const token = tokenOf(device);
    await world.database.admin.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token = $1`,
      [token],
    );
    expect((await device.get('/api/me')).status).toBe(401);
    const { rows } = await world.database.admin.query('SELECT 1 FROM sessions WHERE token = $1', [
      token,
    ]);
    expect(rows).toEqual([]);
  });

  it('подделанная cookie не открывает сессию', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const name = '__Secure-homecrm.session_token';
    const good = device.cookies.get(name) ?? '';
    for (const forged of [
      `${good.slice(0, -6)}AAAAA%3D`, // чужая подпись
      good.split('.')[0] ?? '', // токен без подписи
      `${tokenOf(device)}.${'A'.repeat(43)}%3D`,
    ]) {
      device.cookies.set(name, forged);
      expect((await device.get('/api/me')).status, forged).toBe(401);
    }
  });
});

describe('список устройств и выход (AUTH-6)', () => {
  /** Три устройства Бориса и одно устройство Анны; Анна не должна пострадать. */
  async function devices() {
    const phone = world.device({ userAgent: 'Phone/1.0', ip: '198.51.100.11' });
    const laptop = world.device({ userAgent: 'Laptop/2.0', ip: '198.51.100.12' });
    const tablet = world.device({ userAgent: 'Tablet/3.0', ip: '198.51.100.13' });
    const anna = world.device({ userAgent: 'Anna-Phone/1.0' });
    for (const device of [phone, laptop, tablet])
      await device.signIn('boris', world.boris.password);
    await anna.signIn('anna', world.anna.password);
    return { phone, laptop, tablet, anna };
  }

  it('список показывает устройства с названием программы, адресом и временем — только свои', async () => {
    await world.database.admin.query('DELETE FROM sessions');
    const { phone, anna } = await devices();
    const list = (await phone.get('/api/auth/list-sessions')).json<
      Array<{
        id: string;
        userAgent: string;
        ipAddress: string;
        createdAt: string;
        updatedAt: string;
        expiresAt: string;
        token: string;
      }>
    >();
    expect(list.map((item) => item.userAgent).sort()).toEqual([
      'Laptop/2.0',
      'Phone/1.0',
      'Tablet/3.0',
    ]);
    expect(list.map((item) => item.ipAddress).sort()).toEqual([
      '198.51.100.11',
      '198.51.100.12',
      '198.51.100.13',
    ]);
    for (const item of list) {
      expect(Date.parse(item.createdAt)).toBeLessThanOrEqual(Date.now());
      expect(Date.parse(item.expiresAt)).toBeGreaterThan(Date.now());
    }
    // Сессии Анны в списке Бориса нет.
    const annaList = (await anna.get('/api/auth/list-sessions')).json<
      Array<{ userAgent: string }>
    >();
    expect(annaList.map((item) => item.userAgent)).toEqual(['Anna-Phone/1.0']);
  });

  it('старая сессия тоже видит список: свежесть сессии не требуется', async () => {
    const { phone } = await devices();
    await world.database.admin.query(
      `UPDATE sessions SET created_at = now() - interval '60 days' WHERE token = $1`,
      [tokenOf(phone)],
    );
    expect((await phone.get('/api/auth/list-sessions')).status).toBe(200);
  });

  it('одно устройство можно закрыть — оно теряет доступ сразу, остальные работают', async () => {
    const { phone, laptop, tablet } = await devices();
    const target = tokenOf(laptop);
    const revoked = await phone.post('/api/auth/revoke-session', { token: target });
    expect(revoked.status).toBe(200);
    expect((await laptop.get('/api/me')).status).toBe(401);
    expect((await phone.get('/api/me')).status).toBe(200);
    expect((await tablet.get('/api/me')).status).toBe(200);
  });

  it('чужую сессию закрыть нельзя', async () => {
    const { phone, anna } = await devices();
    const reply = await phone.post('/api/auth/revoke-session', { token: tokenOf(anna) });
    expect(reply.status).toBe(200); // библиотека отвечает одинаково, но ничего не делает
    expect((await anna.get('/api/me')).status).toBe(200);
  });

  it('«Выйти на других устройствах» оставляет только текущее', async () => {
    const { phone, laptop, tablet } = await devices();
    expect((await phone.post('/api/auth/revoke-other-sessions')).status).toBe(200);
    expect((await laptop.get('/api/me')).status).toBe(401);
    expect((await tablet.get('/api/me')).status).toBe(401);
    expect((await phone.get('/api/me')).status).toBe(200);
  });

  it('«Выйти на всех устройствах» закрывает все сессии участника, включая текущую; чужие не трогает', async () => {
    const { phone, laptop, tablet, anna } = await devices();
    const out = await phone.post('/api/auth/revoke-sessions');
    expect(out.status).toBe(200);
    for (const device of [phone, laptop, tablet])
      expect((await device.get('/api/me')).status).toBe(401);
    expect(await sessionsOf(world.boris.id)).toEqual([]);
    expect((await anna.get('/api/me')).status).toBe(200);
  });

  it('обычный выход закрывает только текущую сессию и убирает cookie', async () => {
    const { phone, laptop } = await devices();
    const reply = await phone.post('/api/auth/sign-out');
    expect(reply.status).toBe(200);
    expect(phone.cookies.size).toBe(0);
    expect((await laptop.get('/api/me')).status).toBe(200);
  });

  it('подмена заголовков с адресом клиента не меняет записанный адрес', async () => {
    const device = world.device({ userAgent: 'Spoof/1.0', ip: '198.51.100.99' });
    await device.post(
      '/api/auth/sign-in/username',
      { username: 'boris', password: world.boris.password },
      {
        headers: {
          'x-forwarded-for': '203.0.113.7',
          'x-homecrm-client-ip': '203.0.113.8',
          'cf-connecting-ip': '203.0.113.9',
        },
      },
    );
    const { rows } = await world.database.admin.query<{ ip_address: string }>(
      `SELECT ip_address FROM sessions WHERE user_agent = 'Spoof/1.0'`,
    );
    expect(rows).toEqual([{ ip_address: '198.51.100.99' }]);
  });
});
