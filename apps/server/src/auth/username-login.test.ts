// ADR-0005, строки 1–2: вход по имени пользователя без e-mail (AUTH-1, AUTH-9) и хэш Argon2id (AUTH-1).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorld, type World } from '../testing/world.ts';
import { provisionAccount } from './provision.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

describe('вход по имени пользователя (AUTH-9)', () => {
  it('ребёнок без e-mail входит по имени и паролю', async () => {
    const device = world.device();
    const reply = await device.signIn('vera', world.vera.password);
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({
      user: { id: world.vera.id, username: 'vera', name: 'Вера' },
    });
    expect([...device.cookies.keys()]).toEqual(['__Secure-homecrm.session_token']);

    // Настоящего адреса у неё нет: интерфейс и сервер видят null, в базе — служебный адрес зоны .invalid.
    const me = (await device.get('/api/me')).json();
    expect(me).toMatchObject({ id: world.vera.id, username: 'vera', email: null });
    const { rows } = await world.database.admin.query<{ email: string }>(
      'SELECT email FROM accounts WHERE id = $1',
      [world.vera.id],
    );
    expect(rows[0]?.email).toMatch(/^[0-9a-f-]{36}@no-email\.homecrm\.invalid$/);
  });

  it('имя не зависит от регистра, в том числе кириллическое', async () => {
    await provisionAccount(world.module.db, {
      username: 'Глеб',
      displayName: 'Глеб',
      password: 'gleb-pass-7044-ok',
      householdId: world.houseId,
      role: 'child',
    });
    for (const typed of ['Глеб', 'глеб', 'ГЛЕБ', 'гЛеБ']) {
      const reply = await world.device().signIn(typed, 'gleb-pass-7044-ok');
      expect(reply.status, typed).toBe(200);
    }
    // В базе имя лежит в нормализованном виде и уникально без учёта регистра.
    const { rows } = await world.database.admin.query<{
      username: string;
      display_username: string;
    }>(`SELECT username, display_username FROM accounts WHERE username = 'глеб'`);
    expect(rows).toEqual([{ username: 'глеб', display_username: 'Глеб' }]);
    await expect(
      provisionAccount(world.module.db, {
        username: 'ГЛЕБ',
        displayName: 'Другой Глеб',
        password: 'other-pass-1234-ok',
        householdId: world.houseId,
        role: 'child',
      }),
    ).rejects.toThrow();
  });

  it('неверный пароль и несуществующее имя неразличимы', async () => {
    const wrongPassword = await world.device().signIn('vera', 'совсем-другой-пароль-1');
    const unknownUser = await world.device().signIn('nobody', 'совсем-другой-пароль-1');
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownUser.json());
    expect(wrongPassword.setCookies).toEqual([]);
  });

  it('взрослый входит и по e-mail (AUTH-1), а служебный адрес ребёнка входом не служит', async () => {
    const byEmail = await world.device().post('/api/auth/sign-in/email', {
      email: 'boris@family.test',
      password: world.boris.password,
    });
    expect(byEmail.status).toBe(200);

    const { rows } = await world.database.admin.query<{ email: string }>(
      'SELECT email FROM accounts WHERE id = $1',
      [world.vera.id],
    );
    const placeholder = rows[0]?.email ?? '';
    const child = await world
      .device()
      .post('/api/auth/sign-in/email', { email: placeholder, password: world.vera.password });
    expect(child.status).toBe(401);
  });

  it('регистрации без приглашения нет, поиска свободных имён тоже (AUTH-2)', async () => {
    const before = await world.database.admin.query('SELECT count(*)::int AS n FROM accounts');
    const device = world.device();
    const signUp = await device.post('/api/auth/sign-up/email', {
      email: 'new@family.test',
      password: 'new-member-pass-1',
      name: 'Новичок',
      username: 'novichok',
    });
    expect(signUp.status).toBeGreaterThanOrEqual(400);
    expect(signUp.status).toBeLessThan(500);
    const free = await device.post('/api/auth/is-username-available', { username: 'novichok' });
    expect(free.status).toBe(404);
    const after = await world.database.admin.query('SELECT count(*)::int AS n FROM accounts');
    expect(after.rows).toEqual(before.rows);
  });
});

describe('хэш паролей Argon2id (AUTH-1)', () => {
  it('в базе у каждого пароля — строка Argon2id с параметрами RFC 9106, а не scrypt по умолчанию', async () => {
    const { rows } = await world.database.admin.query<{ password: string }>(
      `SELECT password FROM credentials WHERE provider_id = 'credential'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const { password } of rows) {
      expect(password).toMatch(
        /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
      );
    }
  });

  it('пароль нигде в базе не лежит открытым текстом', async () => {
    const passwords = [world.anna, world.boris, world.vera].map((person) => person.password);
    for (const table of ['accounts', 'credentials', 'sessions', 'verifications', 'login_events']) {
      const { rows } = await world.database.admin.query<{ dump: string }>(
        `SELECT coalesce(string_agg(t::text, ' '), '') AS dump FROM ${table} t`,
      );
      for (const password of passwords) expect(rows[0]?.dump, table).not.toContain(password);
    }
  });

  it('вход проверяет именно этот хэш: с новым экземпляром библиотеки пароль подходит так же', async () => {
    const other = world.device();
    expect((await other.signIn('boris', world.boris.password)).status).toBe(200);
    expect((await other.signIn('boris', `${world.boris.password}x`)).status).toBe(401);
  });
});

describe('длина пароля (AUTH-1): не короче 10 символов', () => {
  it('смена пароля на короткий отклоняется, на десять символов — проходит', async () => {
    const device = world.device();
    await device.signIn('boris', world.boris.password);
    const short = await device.post('/api/auth/change-password', {
      currentPassword: world.boris.password,
      newPassword: '123456789',
    });
    expect(short.status).toBe(400);
    expect(short.json()).toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
    const ok = await device.post('/api/auth/change-password', {
      currentPassword: world.boris.password,
      newPassword: '1234567890',
    });
    expect(ok.status).toBe(200);
  });

  it('и при первой настройке: первый администратор тоже с паролем не короче десяти символов', async () => {
    await expect(
      provisionAccount(world.module.db, {
        username: 'short-pass',
        displayName: 'Короткий',
        password: '123456789',
        householdId: world.houseId,
        role: 'admin',
      }),
    ).rejects.toThrow(RangeError);
    const { rows } = await world.database.admin.query(
      `SELECT 1 FROM accounts WHERE username = 'short-pass'`,
    );
    expect(rows).toEqual([]);
  });
});
