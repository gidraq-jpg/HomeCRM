// ADR-0005, строка 10 (таблицы через адаптер Drizzle) и правила AGENTS.md: форма таблиц сверяется
// с тем, что пишет библиотека; лишние маршруты закрыты; в журналах нет паролей, токенов и секретов.
import { randomUUID } from 'node:crypto';
import {
  accounts,
  credentials,
  rateLimits,
  sessions,
  twoFactors,
  verifications,
} from '@homecrm/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, twoFactor, username } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REDACTED, redactUrl } from '../logging.ts';
import { acceptInvitation, enrollTotp, invite, signedInAdmin } from '../testing/flows.ts';
import { base32Decode, currentCode, parseOtpauth } from '../testing/totp.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;

beforeAll(async () => {
  world = await createWorld({ mail: true });
});

afterAll(async () => {
  await world?.close();
});

type SchemaCheck = () => Promise<void> | undefined;

async function schemaCheckOf(auth: { $context: Promise<unknown> }): Promise<SchemaCheck> {
  const context = (await auth.$context) as { explicitSchemaCheck?: SchemaCheck };
  if (context.explicitSchemaCheck === undefined) throw new Error('The adapter has no schema check');
  return context.explicitSchemaCheck;
}

describe('таблицы через адаптер Drizzle', () => {
  it('форма наших таблиц совпадает с тем, что пишет библиотека с плагинами username и twoFactor', async () => {
    const check = await schemaCheckOf(world.module.auth);
    await expect(Promise.resolve(check())).resolves.toBeUndefined();
  });

  it('сверка замечает расхождение: плагин admin ждёт колонок, которых в нашей схеме нет', async () => {
    // Так обновление библиотеки или новый плагин сразу скажут, что нужна миграция, а не упадут на запросе.
    const drifted = betterAuth({
      baseURL: 'http://homecrm.test',
      secret: 'drift-check-secret-drift-check-secret-12345',
      database: drizzleAdapter(world.module.db, {
        provider: 'pg',
        schema: { accounts, sessions, credentials, verifications, twoFactors, rateLimits },
      }),
      user: { modelName: 'accounts', fields: { name: 'displayName' } },
      session: { modelName: 'sessions' },
      account: { modelName: 'credentials' },
      verification: { modelName: 'verifications' },
      advanced: { database: { generateId: false } },
      plugins: [username(), twoFactor({ twoFactorTable: 'twoFactors' }), admin()],
    });
    const check = await schemaCheckOf(drifted);
    await expect(Promise.resolve(check())).rejects.toThrow(
      /Drizzle schema mismatch[\s\S]*Missing columns[\s\S]*accounts\.role/,
    );
  });

  it('библиотека работает с uuid v7 от базы и пишет в наши таблицы', async () => {
    await world.device().signIn('boris', world.boris.password);
    const { rows } = await world.database.admin.query<{ id: string; version: string }>(
      `SELECT id, substr(id::text, 15, 1) AS version FROM sessions LIMIT 1`,
    );
    expect(rows[0]?.version).toBe('7');
    const rate = await world.database.admin.query('SELECT count(*)::int AS n FROM rate_limits');
    expect(rate.rows[0]?.n).toBeGreaterThan(0); // счётчики ограничения запросов — в базе
  });
});

describe('лишние маршруты закрыты', () => {
  it('внешние поставщики, подтверждение и смена почты, самоудаление, проверка имён — 404', async () => {
    const device = world.device();
    const routes: Array<['GET' | 'POST', string]> = [
      ['POST', '/api/auth/sign-in/social'],
      ['POST', '/api/auth/link-social'],
      ['POST', '/api/auth/unlink-account'],
      ['GET', '/api/auth/callback/google'],
      ['POST', '/api/auth/get-access-token'],
      ['POST', '/api/auth/refresh-token'],
      ['GET', '/api/auth/list-accounts'],
      ['GET', '/api/auth/account-info'],
      ['GET', '/api/auth/verify-email'],
      ['POST', '/api/auth/send-verification-email'],
      ['POST', '/api/auth/change-email'],
      ['POST', '/api/auth/delete-user'],
      ['GET', '/api/auth/delete-user/callback'],
      ['POST', '/api/auth/update-session'],
      ['POST', '/api/auth/is-username-available'],
      ['POST', '/api/auth/two-factor/send-otp'],
      ['POST', '/api/auth/two-factor/verify-otp'],
      ['GET', '/api/auth/error'],
      ['POST', '/api/auth/verify-password'],
    ];
    for (const [method, url] of routes) {
      const reply = await device.request(method, url, method === 'POST' ? { json: {} } : {});
      expect(reply.status, `${method} ${url}`).toBe(404);
    }
  });
});

describe('журналы без секретов (AGENTS.md, правило 1)', () => {
  it('redactUrl вырезает токены из адресов', () => {
    const token = 'A'.repeat(43);
    expect(redactUrl(`/invite/${token}`)).toBe(`/invite/${REDACTED}`);
    expect(redactUrl(`/reset-password/${token}?x=1`)).toBe(`/reset-password/${REDACTED}?x=1`);
    expect(redactUrl(`/api/auth/reset-password/${token}?callbackURL=%2Fa`)).toBe(
      `/api/auth/reset-password/${REDACTED}?callbackURL=%2Fa`,
    );
    expect(redactUrl(`/reset-password?token=${token}&a=b`)).toBe(
      `/reset-password?token=${REDACTED}&a=b`,
    );
    expect(redactUrl('/api/me?a=1')).toBe('/api/me?a=1');
  });

  it('после всех сценариев входа в журналах нет ни паролей, ни токенов, ни секретов', async () => {
    const secrets = new Map<string, string>();
    const track = (label: string, value: string | undefined) => {
      if (value) secrets.set(label, value);
    };
    track('секрет Better Auth', world.secret);
    for (const person of [world.anna, world.boris, world.vera]) {
      track(`пароль ${person.username}`, person.password);
    }

    // Администратор: вход, второй фактор, приглашение, сброс пароля ребёнку.
    const { device: annaDevice, enrollment } = await signedInAdmin(world);
    const parsed = parseOtpauth(enrollment.uri);
    track('секрет TOTP', parsed.secret.toString());
    track('секрет TOTP (base32)', new URL(enrollment.uri).searchParams.get('secret') ?? undefined);
    base32Decode(new URL(enrollment.uri).searchParams.get('secret') ?? '');
    for (const code of enrollment.backupCodes) track(`код восстановления ${code}`, code);
    track(
      'сессия администратора',
      decodeURIComponent(annaDevice.cookies.get('__Secure-homecrm.session_token') ?? '').split(
        '.',
      )[0],
    );

    const link = await invite(annaDevice, world, 'adult');
    track('токен приглашения', link.token);
    const newcomerPassword = `newcomer-${randomUUID()}`;
    track('пароль новичка', newcomerPassword);
    const accepted = await acceptInvitation(world.device(), {
      token: link.token,
      username: 'hygiene-guest',
      password: newcomerPassword,
    });
    expect(accepted.status, accepted.text).toBe(200);
    // Ссылка-приглашение открывается как страница приложения; сервер видит её адрес.
    await world.device().get(`/invite/${link.token}`);

    await world.clearRateLimits();
    const reset = await annaDevice.post('/api/auth/homecrm/child-reset-link', {
      accountId: world.vera.id,
    });
    expect(reset.status, reset.text).toBe(200);
    const resetToken = reset.json<{ token: string }>().token;
    track('токен сброса пароля ребёнка', resetToken);
    const veraNew = `vera-new-${randomUUID()}`;
    track('новый пароль ребёнка', veraNew);
    await world.device().get(`/reset-password?token=${resetToken}`);
    expect(
      (
        await world
          .device()
          .post('/api/auth/reset-password', { token: resetToken, newPassword: veraNew })
      ).status,
    ).toBe(200);

    // Неверные пароли и коды.
    const wrongPassword = `wrong-${randomUUID()}`;
    track('неверный пароль', wrongPassword);
    await world.device().signIn('boris', wrongPassword);
    await world.clearRateLimits();
    const second = world.device();
    await second.signIn('anna', world.anna.password);
    const wrongCode = '123456';
    await second.post('/api/auth/two-factor/verify-totp', { code: wrongCode });
    await world.clearRateLimits();
    await second.post('/api/auth/two-factor/verify-totp', { code: currentCode(enrollment.uri) });
    track(
      'сессия после второго фактора',
      decodeURIComponent(second.cookies.get('__Secure-homecrm.session_token') ?? '').split('.')[0],
    );

    // Восстановление по почте: токен в адресе из письма.
    world.mailbox.length = 0;
    await world.device().post('/api/auth/request-password-reset', {
      email: 'boris@family.test',
      redirectTo: '/reset-password',
    });
    const emailUrl = new URL(/(https?:\/\/\S+)/.exec(world.mailbox[0]?.text ?? '')?.[1] ?? '');
    const emailToken = emailUrl.pathname.split('/').pop() ?? '';
    track('токен сброса из письма', emailToken);
    await world.device().request('GET', `${emailUrl.pathname}${emailUrl.search}`, { origin: null });

    // Ещё один пользователь включает второй фактор: его секрет тоже не должен всплыть.
    const boris = world.device();
    await boris.signIn('boris', world.boris.password);
    const borisEnrollment = await enrollTotp(boris, world.boris).catch(() => undefined);
    track(
      'секрет TOTP Бориса',
      borisEnrollment
        ? (new URL(borisEnrollment.uri).searchParams.get('secret') ?? undefined)
        : undefined,
    );

    const libraryLog = world.logs.join('\n');
    const requestLog = world.requestLog.join('\n');
    expect(requestLog.length).toBeGreaterThan(1000); // журналы не пусты: проверка не вырождена
    expect(world.logs.some((line) => line.includes('Invalid password'))).toBe(true);
    for (const [label, value] of secrets) {
      expect(libraryLog, `журнал библиотеки: ${label}`).not.toContain(value);
      expect(requestLog, `журнал запросов: ${label}`).not.toContain(value);
    }
    // Токены из адресов вырезаны, а не просто не попали.
    expect(requestLog).toContain(REDACTED);
  });
});
