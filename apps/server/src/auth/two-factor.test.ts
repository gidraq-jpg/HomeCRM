// ADR-0005, строки 4–5: TOTP, обязательный для администратора (AUTH-3), и десять одноразовых
// кодов восстановления (AUTH-4). Коды считает независимая реализация RFC 6238 (testing/totp.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { type Enrollment, enrollTotp, signInWithTotp } from '../testing/flows.ts';
import { currentCode, parseOtpauth } from '../testing/totp.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
// Анна проходит все этапы по порядку: без второго фактора → включает → входит с кодом.
let annaA: Device;
let annaEnrollment: Enrollment;

beforeAll(async () => {
  world = await createWorld();
});

afterAll(async () => {
  await world?.close();
});

const meOf = async (device: Device) =>
  (await device.get('/api/me')).json<Record<string, unknown>>();

describe('второй фактор обязателен администратору (AUTH-3)', () => {
  it('без него администратор входит, но данные и управление домом закрыты', async () => {
    annaA = world.device({ userAgent: 'Anna-Phone' });
    expect((await annaA.signIn(world.anna.username, world.anna.password)).status).toBe(200);

    expect(await meOf(annaA)).toMatchObject({
      secondFactorRequired: true,
      twoFactorEnabled: false,
    });
    for (const [method, url] of [
      ['GET', '/api/notes'],
      ['POST', '/api/invitations'],
      ['POST', '/api/export'],
    ] as const) {
      const reply = await annaA.request(method, url, method === 'POST' ? { json: {} } : {});
      expect(reply.status, url).toBe(403);
      expect(reply.json(), url).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
    }
    // Управление детьми через библиотеку закрыто так же.
    const resetLink = await annaA.post('/api/auth/homecrm/child-reset-link', {
      accountId: world.vera.id,
    });
    expect(resetLink.status).toBe(403);
    expect(resetLink.json()).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED' });
  });

  it('взрослому второй фактор не обязателен', async () => {
    const boris = world.device();
    await boris.signIn(world.boris.username, world.boris.password);
    expect(await meOf(boris)).toMatchObject({ secondFactorRequired: false });
    expect((await boris.get('/api/notes')).status).toBe(200);
  });
});

describe('включение TOTP', () => {
  it('нужен пароль; ссылка — для приложения-аутентификатора; десять кодов восстановления', async () => {
    const noPassword = await annaA.post('/api/auth/two-factor/enable', {});
    expect(noPassword.status).toBe(400);
    const wrong = await annaA.post('/api/auth/two-factor/enable', {
      password: 'совсем-не-тот-пароль',
    });
    expect(wrong.status).toBe(400);
    expect(wrong.json()).toMatchObject({ code: 'INVALID_PASSWORD' });

    const enabled = await annaA.post('/api/auth/two-factor/enable', {
      password: world.anna.password,
    });
    expect(enabled.status, enabled.text).toBe(200);
    const { totpURI, backupCodes } = enabled.json<{ totpURI: string; backupCodes: string[] }>();

    const uri = new URL(totpURI);
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.hostname).toBe('totp');
    expect(uri.searchParams.get('issuer')).toBe('HomeCRM');
    expect(parseOtpauth(totpURI)).toMatchObject({ digits: 6, period: 30 });
    expect(parseOtpauth(totpURI).secret.length).toBeGreaterThanOrEqual(20);

    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);
    for (const code of backupCodes) expect(code).toMatch(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/);
    annaEnrollment = { uri: totpURI, backupCodes };

    // Пока код из приложения не подтверждён, второй фактор не включён и вход его не требует.
    expect(await meOf(annaA)).toMatchObject({
      twoFactorEnabled: false,
      secondFactorRequired: true,
    });
    expect((await annaA.get('/api/notes')).status).toBe(403);
  });

  it('неверный код не включает второй фактор, верный — включает и открывает данные', async () => {
    const wrongCode = String((Number(currentCode(annaEnrollment.uri)) + 1) % 1_000_000).padStart(
      6,
      '0',
    );
    // Ближайшие соседние коды окна тоже могли бы подойти — берём заведомо далёкий.
    const far = currentCode(annaEnrollment.uri, Date.now() + 10 * 60 * 1000);
    const bad = await annaA.post('/api/auth/two-factor/verify-totp', {
      code: far === currentCode(annaEnrollment.uri) ? wrongCode : far,
    });
    expect(bad.status).toBe(401);
    expect(await meOf(annaA)).toMatchObject({ twoFactorEnabled: false });

    const good = await annaA.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
    });
    expect(good.status, good.text).toBe(200);
    expect(await meOf(annaA)).toMatchObject({
      twoFactorEnabled: true,
      secondFactorRequired: false,
    });
    expect((await annaA.get('/api/notes')).status).toBe(200);
  });

  it('секрет и коды восстановления хранятся зашифрованными', async () => {
    const { rows } = await world.database.admin.query<{
      secret: string;
      backup_codes: string;
      verified: boolean;
    }>('SELECT secret, backup_codes, verified FROM two_factors WHERE user_id = $1', [
      world.anna.id,
    ]);
    expect(rows).toHaveLength(1);
    const {
      secret,
      backup_codes: stored,
      verified,
    } = rows[0] ?? { secret: '', backup_codes: '', verified: false };
    expect(verified).toBe(true);
    const raw = parseOtpauth(annaEnrollment.uri).secret.toString();
    expect(secret).not.toContain(raw);
    expect(secret).toMatch(/^[0-9a-f]+$/);
    for (const code of annaEnrollment.backupCodes) expect(stored).not.toContain(code);
    expect(
      (
        await world.database.admin.query('SELECT two_factor_enabled FROM accounts WHERE id = $1', [
          world.anna.id,
        ])
      ).rows,
    ).toEqual([{ two_factor_enabled: true }]);
  });
});

describe('вход со вторым фактором', () => {
  it('после пароля сессии ещё нет, код приложения её выдаёт', async () => {
    world.clearRateLimits();
    const device = world.device();
    const first = await device.signIn(world.anna.username, world.anna.password);
    expect(first.status).toBe(200);
    expect(first.json()).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    // Сессионной cookie у устройства нет: библиотека её гасит (Max-Age=0), а выдаёт cookie незавершённого входа.
    expect([...device.cookies.keys()]).toEqual(['__Secure-homecrm.two_factor']);
    expect((await device.get('/api/me')).status).toBe(401);

    const wrong = await device.post('/api/auth/two-factor/verify-totp', { code: '000000' });
    expect([401, 429]).toContain(wrong.status);
    expect((await device.get('/api/me')).status).toBe(401);

    await world.clearRateLimits();
    const ok = await device.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
    });
    expect(ok.status, ok.text).toBe(200);
    expect((await device.get('/api/notes')).status).toBe(200);
  });

  it('пять неверных кодов гасят попытку входа: даже верный код уже не поможет', async () => {
    const device = world.device();
    await device.signIn(world.anna.username, world.anna.password);
    for (let attempt = 0; attempt < 5; attempt++) {
      await world.clearRateLimits(); // ограничение запросов по адресу здесь не предмет проверки
      const wrong = await device.post('/api/auth/two-factor/verify-totp', { code: '000000' });
      expect(wrong.status, `попытка ${attempt + 1}`).toBe(401);
    }
    await world.clearRateLimits();
    const late = await device.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
    });
    expect(late.status).toBe(400);
    expect(late.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' });
    expect((await device.get('/api/me')).status).toBe(401);
  });

  it('десять неверных кодов подряд блокируют второй фактор учётной записи на 15 минут', async () => {
    // Вход заново на каждые пять попыток: по пять на попытку входа, по десять на учётную запись.
    for (let round = 0; round < 2; round++) {
      const device = world.device();
      await world.clearRateLimits();
      await device.signIn(world.anna.username, world.anna.password);
      for (let attempt = 0; attempt < 5; attempt++) {
        await world.clearRateLimits();
        await device.post('/api/auth/two-factor/verify-totp', { code: '000000' });
      }
    }
    const device = world.device();
    await world.clearRateLimits();
    await device.signIn(world.anna.username, world.anna.password);
    await world.clearRateLimits();
    const blocked = await device.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    // Время переведено: блокировка снята.
    await world.database.admin.query(
      `UPDATE two_factors SET locked_until = now() - interval '1 second' WHERE user_id = $1`,
      [world.anna.id],
    );
    await world.clearRateLimits();
    const open = await device.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
    });
    expect(open.status, open.text).toBe(200);
  });

  it('код из приложения принимается повторно в том же окне: защиты от повтора в библиотеке нет', async () => {
    // RFC 6238, раздел 5.2, требует принимать код один раз. Библиотека этого не делает: код
    // подслушанный (но не пароль) за 30 секунд даёт второй вход. Риск низкий — нужен ещё пароль —
    // и записан в ADR-0005; если библиотека это исправит, этот тест напомнит обновить запись.
    const code = currentCode(annaEnrollment.uri);
    const results: number[] = [];
    for (const _ of [1, 2]) {
      const device = world.device();
      await world.clearRateLimits();
      await device.signIn(world.anna.username, world.anna.password);
      await world.clearRateLimits();
      results.push((await device.post('/api/auth/two-factor/verify-totp', { code })).status);
    }
    expect(results).toEqual([200, 200]);
  });

  it('«доверять устройству»: с cookie доверия повторный вход обходится без кода', async () => {
    const device = world.device();
    await device.signIn(world.anna.username, world.anna.password);
    await world.clearRateLimits();
    const trusted = await device.post('/api/auth/two-factor/verify-totp', {
      code: currentCode(annaEnrollment.uri),
      trustDevice: true,
    });
    expect(trusted.status).toBe(200);
    expect([...device.cookies.keys()].some((name) => name.endsWith('trust_device'))).toBe(true);
    await device.post('/api/auth/sign-out');
    const again = await device.signIn(world.anna.username, world.anna.password);
    expect(again.json()).not.toHaveProperty('twoFactorRedirect');
    expect((await device.get('/api/notes')).status).toBe(200);
  });
});

describe('коды восстановления (AUTH-4)', () => {
  it('код входит вместо TOTP один раз; остаются девять', async () => {
    const [first, second] = annaEnrollment.backupCodes as [string, string];
    const device = world.device();
    await world.clearRateLimits();
    await device.signIn(world.anna.username, world.anna.password);
    await world.clearRateLimits();
    const used = await device.post('/api/auth/two-factor/verify-backup-code', { code: first });
    expect(used.status, used.text).toBe(200);
    expect((await device.get('/api/notes')).status).toBe(200);

    const other = world.device();
    await world.clearRateLimits();
    await other.signIn(world.anna.username, world.anna.password);
    await world.clearRateLimits();
    const reuse = await other.post('/api/auth/two-factor/verify-backup-code', { code: first });
    expect(reuse.status).toBe(401);
    expect(reuse.json()).toMatchObject({ code: 'INVALID_BACKUP_CODE' });

    // Следующий код этого же набора по-прежнему годен.
    await world.clearRateLimits();
    expect(
      (await other.post('/api/auth/two-factor/verify-backup-code', { code: second })).status,
    ).toBe(200);

    const left = await world.module.auth.api.viewBackupCodes({ body: { userId: world.anna.id } });
    expect(left.backupCodes).toHaveLength(8);
    expect(left.backupCodes).not.toContain(first);
    expect(left.backupCodes).not.toContain(second);
  });

  it('новый набор требует пароль и отменяет старый', async () => {
    const [stale] = annaEnrollment.backupCodes.slice(5) as [string];
    const noPassword = await annaA.post('/api/auth/two-factor/generate-backup-codes', {});
    expect(noPassword.status).toBe(400);
    await world.clearRateLimits();
    const fresh = await annaA.post('/api/auth/two-factor/generate-backup-codes', {
      password: world.anna.password,
    });
    expect(fresh.status, fresh.text).toBe(200);
    const { backupCodes } = fresh.json<{ backupCodes: string[] }>();
    expect(backupCodes).toHaveLength(10);
    expect(backupCodes).not.toContain(stale);

    const device = world.device();
    await world.clearRateLimits();
    await device.signIn(world.anna.username, world.anna.password);
    await world.clearRateLimits();
    expect(
      (await device.post('/api/auth/two-factor/verify-backup-code', { code: stale })).status,
    ).toBe(401);
    await world.clearRateLimits();
    expect(
      (await device.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] }))
        .status,
    ).toBe(200);
  });
});

describe('выключить второй фактор', () => {
  it('администратору нельзя: он обязателен', async () => {
    await world.clearRateLimits();
    const reply = await annaA.post('/api/auth/two-factor/disable', {
      password: world.anna.password,
    });
    expect(reply.status).toBe(403);
    expect(reply.json()).toMatchObject({ code: 'SECOND_FACTOR_REQUIRED_FOR_ADMIN' });
    expect(await meOf(annaA)).toMatchObject({ twoFactorEnabled: true });
  });

  it('взрослый включает его по желанию и выключает паролем', async () => {
    const boris = world.device();
    await boris.signIn(world.boris.username, world.boris.password);
    const enrollment = await enrollTotp(boris, world.boris);
    expect(await meOf(boris)).toMatchObject({ twoFactorEnabled: true });

    // С включённым вторым фактором вход взрослого идёт в два шага.
    const other = world.device();
    await world.clearRateLimits();
    await signInWithTotp(other, world.boris, enrollment);

    await world.clearRateLimits();
    const noPassword = await boris.post('/api/auth/two-factor/disable', {});
    expect(noPassword.status).toBe(400);
    const off = await boris.post('/api/auth/two-factor/disable', {
      password: world.boris.password,
    });
    expect(off.status, off.text).toBe(200);
    expect(await meOf(boris)).toMatchObject({ twoFactorEnabled: false });
    expect(
      (
        await world.database.admin.query('SELECT 1 FROM two_factors WHERE user_id = $1', [
          world.boris.id,
        ])
      ).rows,
    ).toEqual([]);
  });
});
