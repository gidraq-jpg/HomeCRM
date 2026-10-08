// Маршруты входа на Fastify: мост к Better Auth и маршруты, которым нужен вошедший участник.
// Маршруты данных работают от имени участника: сессию проверяет библиотека (роль homecrm_auth),
// а запросы к данным идут через withAccount (роль homecrm_app), то есть под RLS (ADR-0004).
import {
  type AppDatabase,
  accounts,
  and,
  type Database,
  desc,
  eq,
  invitations,
  isNull,
  loginEvents,
  memberProfiles,
  passwordResets,
  sessions,
  spaces,
  sql,
} from '@homecrm/db';
import { canInvite, ROLES } from '@homecrm/shared';
import { exportNotes } from '../notes/routes.ts';
import { type Account, createAccountReader } from './account.ts';

export type { Account } from './account.ts';

import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';
import { clearFailures, reserveAttempt } from './attempts.ts';
import { type Auth, type AuthOptions, createAuth } from './auth.ts';
import { newInvitationToken } from './identity.ts';
import { CLIENT_IP_HEADER } from './plugin.ts';
import { pgError } from './provision.ts';
import { reserveSessionRequest } from './rate-limit.ts';
import { checkRequestSource } from './request-source.ts';

export interface AuthModule {
  auth: Auth;
  /** Служба входа: роль homecrm_auth. */
  db: Database;
  /** Приложение: роль homecrm_app. */
  appDb: AppDatabase;
  baseURL: string;
  /** Откуда принимаются изменяющие запросы с cookie. */
  origins: ReadonlySet<string>;
  /** Часовой пояс дома (IANA): клиент показывает даты в нём. */
  homeTimeZone: string;
}

/** Сколько дней после сброса отметку не может закрыть никто (AUTH-5, решение владельца 6 октября). */
export const RESET_NOTICE_LOCK_DAYS = 7;
const DEFAULT_HOME_TIME_ZONE = 'Asia/Yekaterinburg';

export function createAuthModule(options: AuthOptions): AuthModule {
  const origin = new URL(options.baseURL).origin;
  return {
    auth: createAuth(options),
    db: options.db,
    appDb: options.appDb,
    baseURL: origin,
    origins: new Set([origin, ...(options.trustedOrigins ?? [])]),
    homeTimeZone: options.homeTimeZone ?? DEFAULT_HOME_TIME_ZONE,
  };
}

function fail(reply: FastifyReply, status: number, code: string, message: string): null {
  void reply.code(status).send({ code, message });
  return null;
}

export async function authRoutes(app: FastifyInstance, module: AuthModule): Promise<void> {
  const { auth, db, appDb } = module;

  // ---- Мост к Better Auth: /api/auth/* целиком обслуживает библиотека ----------------------
  await app.register(async (scope) => {
    // Тело отдаём библиотеке как есть, строкой: ни разбор, ни повторная сериализация ей не нужны.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) =>
      done(null, body),
    );
    scope.route({
      method: ['GET', 'POST'],
      url: '/api/auth/*',
      handler: async (request, reply) => {
        // Адрес берём из настроек, а не из заголовка Host: подмена Host не меняет ссылки библиотеки.
        const url = new URL(request.url, module.baseURL);
        // Возвраты от внешних поставщиков входа не нужны, а disabledPaths маршруты с параметрами не закрывает.
        if (url.pathname.startsWith('/api/auth/callback/')) {
          return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found' });
        }
        const headers = fromNodeHeaders(request.headers);
        // Адрес клиента — единственный заголовок, которому доверяет библиотека; его значение
        // всегда наше (request.ip учитывает trustProxy Fastify), присланное клиентом затирается.
        headers.set(CLIENT_IP_HEADER, request.ip);
        const hasBody =
          request.method !== 'GET' && typeof request.body === 'string' && request.body.length > 0;
        const response = await auth.handler(
          new Request(url, {
            method: request.method,
            headers,
            ...(hasBody ? { body: request.body as string } : {}),
          }),
        );
        void reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'set-cookie') void reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) void reply.header('set-cookie', cookies);
        return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
      },
    });
  });

  // ---- Устройства: наружу только метаданные, отзыв проверяет id и владельца вместе ----------
  /**
   * Сессия из cookie → участник. Продление сессии библиотека сообщает заголовками Set-Cookie:
   * они пересылаются клиенту, иначе cookie истекла бы раньше записи в базе.
   */
  const currentAccount = createAccountReader(module);
  const sessionProtection = {
    onRequest: async (request: FastifyRequest, reply: FastifyReply) => {
      const error = checkRequestSource(
        fromNodeHeaders(request.headers),
        (origin) => module.origins.has(origin),
        request.method === 'POST',
      );
      if (error !== null) return reply.code(403).send(error);
      const retryAfter = await reserveSessionRequest(
        db,
        `session:${request.ip}:${request.routeOptions.url}`,
      );
      if (retryAfter !== null) {
        void reply.header('retry-after', String(retryAfter));
        void reply.header('x-retry-after', String(retryAfter));
        return reply
          .code(429)
          .send({ code: 'TOO_MANY_REQUESTS', message: 'Too many requests, try later' });
      }
    },
  };
  app.get('/api/auth/list-sessions', sessionProtection, async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    const devices = await db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, account.id),
          sql`${sessions.expiresAt} > now()`,
          sql`${sessions.token} ~ '^h1:[0-9a-f]{64}$'`,
        ),
      )
      .orderBy(desc(sessions.createdAt), desc(sessions.id));
    return devices.map((device) => ({ ...device, current: device.id === account.sessionId }));
  });

  const revokeDevice = z.strictObject({ id: z.uuid() });
  app.post('/api/auth/revoke-session', sessionProtection, async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    const parsed = revokeDevice.safeParse(request.body);
    if (!parsed.success) return fail(reply, 400, 'INVALID_BODY', 'Invalid session id');
    const removed = await db
      .delete(sessions)
      .where(and(eq(sessions.id, parsed.data.id), eq(sessions.userId, account.id)))
      .returning({ id: sessions.id });
    if (removed.length === 0) return fail(reply, 404, 'NOT_FOUND', 'Session not found');
    if (parsed.data.id === account.sessionId) {
      // Библиотека гасит все свои cookie теми же атрибутами, что при обычном выходе.
      const signedOut = await auth.api.signOut({
        headers: fromNodeHeaders(request.headers),
        returnHeaders: true,
      });
      void reply.header('set-cookie', signedOut.headers.getSetCookie());
    }
    return { status: true };
  });

  app.post('/api/auth/revoke-other-sessions', sessionProtection, async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, account.id), sql`${sessions.id} <> ${account.sessionId}`));
    return { status: true };
  });

  // ---- Маршруты данных: нужен вошедший участник ---------------------------------------------

  /** Повторный ввод пароля перед чувствительным действием (AUTH-7); неверные пароли копятся в блокировку. */
  async function confirmPassword(
    request: FastifyRequest,
    reply: FastifyReply,
    account: Account,
    password: unknown,
  ): Promise<boolean> {
    if (typeof password !== 'string' || password.length === 0) {
      fail(reply, 400, 'PASSWORD_REQUIRED', 'Enter your password to continue');
      return false;
    }
    // Попытка занимается до проверки пароля (attempts.ts): параллельные запросы не обгонят счётчик.
    const reservation = await reserveAttempt(db, { accountId: account.id });
    if (!reservation.allowed) {
      const seconds = Math.max(
        1,
        Math.ceil((reservation.lockedUntil.getTime() - Date.now()) / 1000),
      );
      void reply.header('retry-after', String(seconds));
      fail(reply, 429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many attempts, try later');
      return false;
    }
    try {
      await auth.api.verifyPassword({
        headers: fromNodeHeaders(request.headers),
        body: { password },
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
      fail(reply, 403, 'INVALID_PASSWORD', 'Wrong password');
      return false;
    }
    await clearFailures(db, { accountId: account.id });
    return true;
  }

  app.get('/api/me', async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    const { notices, profile, personalSpace } = await appDb.withAccount(account.id, async (tx) => ({
      personalSpace: (
        await tx
          .select({ id: spaces.id })
          .from(spaces)
          .where(and(eq(spaces.kind, 'personal'), eq(spaces.ownerAccountId, account.id)))
      )[0],
      notices: await tx
        .select({ id: passwordResets.id, completedAt: passwordResets.completedAt })
        .from(passwordResets)
        .where(
          and(
            sql`${passwordResets.completedAt} IS NOT NULL`,
            isNull(passwordResets.acknowledgedAt),
          ),
        )
        .orderBy(desc(passwordResets.completedAt), desc(passwordResets.id)),
      profile: (
        await tx.select().from(memberProfiles).where(eq(memberProfiles.accountId, account.id))
      )[0],
    }));
    const completedAt = notices[0]?.completedAt ?? null;
    return {
      id: account.id,
      personalSpaceId: personalSpace?.id ?? null,
      displayName: profile?.displayName ?? account.displayName,
      username: account.username,
      email: account.email,
      twoFactorEnabled: account.twoFactorEnabled,
      secondFactorRequired: account.secondFactorPending,
      roles: [...account.viewer.memberships].map(([householdId, role]) => ({ householdId, role })),
      timeZone: module.homeTimeZone,
      // Ребёнок видит, что пароль сбрасывали, пока не подтвердит, что прочитал (AUTH-5);
      // первые 7 дней подтвердить нельзя никому, в том числе вошедшему по ссылке администратору.
      passwordReset: completedAt
        ? {
            completedAt,
            // С этого момента кнопка «Я прочитал» доступна, а сервер принимает подтверждение.
            ackAllowedAt: new Date(
              completedAt.getTime() + RESET_NOTICE_LOCK_DAYS * 86_400_000,
            ).toISOString(),
          }
        : null,
    };
  });

  app.post('/api/me/password-reset/ack', async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    // Первые 7 дней отметку не закрыть никому (AUTH-5): иначе администратор, вошедший по ссылке
    // от имени ребёнка, закрыл бы её раньше, чем ребёнок увидит.
    const result = await appDb.withAccount(account.id, async (tx) => {
      const closed = await tx
        .update(passwordResets)
        .set({ acknowledgedAt: sql`now()` })
        .where(
          and(
            isNull(passwordResets.acknowledgedAt),
            sql`${passwordResets.completedAt} <= now() - make_interval(days => ${RESET_NOTICE_LOCK_DAYS})`,
          ),
        );
      if ((closed.rowCount ?? 0) > 0) return closed.rowCount ?? 0;
      const waiting = await tx
        .select({ id: passwordResets.id })
        .from(passwordResets)
        .where(
          and(
            isNull(passwordResets.acknowledgedAt),
            sql`${passwordResets.completedAt} IS NOT NULL`,
          ),
        )
        .limit(1);
      return waiting.length > 0 ? ('locked' as const) : 0;
    });
    if (result === 'locked') {
      return fail(reply, 409, 'RESET_NOTICE_LOCKED', 'The notice cannot be closed yet');
    }
    return { acknowledged: result };
  });

  app.get('/api/login-events', async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    // Без where: свои строки оставляет RLS (canViewAccountJournal).
    return appDb.withAccount(account.id, (tx) =>
      tx
        .select({
          kind: loginEvents.kind,
          outcome: loginEvents.outcome,
          ipAddress: loginEvents.ipAddress,
          userAgent: loginEvents.userAgent,
          createdAt: loginEvents.createdAt,
        })
        .from(loginEvents)
        .orderBy(desc(loginEvents.createdAt))
        .limit(50),
    );
  });

  const InvitationBody = z.object({ householdId: z.uuid(), role: z.enum(ROLES) });
  app.post('/api/invitations', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (account === null) return reply;
    const body = InvitationBody.safeParse(request.body);
    if (!body.success) return fail(reply, 400, 'INVALID_BODY', 'Invalid request body');
    // Проверка в коде по эталону и политика базы invitations_insert дают один ответ (ADR-0004).
    if (!canInvite(account.viewer, body.data.householdId)) {
      return fail(reply, 403, 'FORBIDDEN', 'Only a household administrator can invite');
    }
    const { token, hash } = newInvitationToken();
    try {
      const [created] = await appDb.withAccount(account.id, (tx) =>
        tx
          .insert(invitations)
          .values({
            householdId: body.data.householdId,
            role: body.data.role,
            tokenHash: hash,
            createdBy: account.id,
          })
          .returning({ id: invitations.id, expiresAt: invitations.expiresAt }),
      );
      return reply.code(201).send({
        id: created?.id,
        url: `${module.baseURL}/invite/${token}`,
        token,
        expiresAt: created?.expiresAt,
      });
    } catch (error) {
      if (pgError(error).code === '42501') {
        return fail(reply, 403, 'FORBIDDEN', 'Only a household administrator can invite');
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>('/api/invitations/:id/revoke', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (account === null) return reply;
    if (!z.uuid().safeParse(request.params.id).success) {
      return fail(reply, 400, 'INVALID_BODY', 'Invalid invitation id');
    }
    const revoked = await appDb.withAccount(account.id, (tx) =>
      tx
        .update(invitations)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(invitations.id, request.params.id), isNull(invitations.revokedAt))),
    );
    if ((revoked.rowCount ?? 0) !== 1) return fail(reply, 404, 'NOT_FOUND', 'Invitation not found');
    return { revoked: true };
  });

  /** Пример чувствительного действия: выгрузка своих данных; нужен пароль (AUTH-7). */
  app.post('/api/export', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (account === null) return reply;
    const body = (request.body ?? {}) as { password?: unknown };
    if (!(await confirmPassword(request, reply, account, body.password))) return reply;
    const [profile, mine, familyProfile] = await appDb.withAccount(account.id, (tx) =>
      Promise.all([
        tx
          .select({ displayName: accounts.displayName, username: accounts.username })
          .from(accounts)
          .where(eq(accounts.id, account.id)),
        exportNotes(tx, account),
        tx.select().from(memberProfiles).where(eq(memberProfiles.accountId, account.id)),
      ]),
    );
    return {
      exportedAt: new Date().toISOString(),
      profile: profile[0] ? { ...profile[0], ...familyProfile[0] } : null,
      notes: mine,
    };
  });
}
