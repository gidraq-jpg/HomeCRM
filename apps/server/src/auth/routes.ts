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
  notes,
  passwordResets,
  sql,
} from '@homecrm/db';
import { canInvite, mustUseSecondFactor, ROLES, type Viewer } from '@homecrm/shared';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';
import { clearFailures, lockedUntil, recordFailure } from './attempts.ts';
import { type Auth, type AuthOptions, createAuth } from './auth.ts';
import { isPlaceholderEmail, newInvitationToken } from './identity.ts';
import { CLIENT_IP_HEADER } from './plugin.ts';
import { loadViewer, pgError } from './provision.ts';

export interface AuthModule {
  auth: Auth;
  /** Служба входа: роль homecrm_auth. */
  db: Database;
  /** Приложение: роль homecrm_app. */
  appDb: AppDatabase;
  baseURL: string;
  /** Откуда принимаются изменяющие запросы с cookie. */
  origins: ReadonlySet<string>;
}

export function createAuthModule(options: AuthOptions): AuthModule {
  const origin = new URL(options.baseURL).origin;
  return {
    auth: createAuth(options),
    db: options.db,
    appDb: options.appDb,
    baseURL: origin,
    origins: new Set([origin, ...(options.trustedOrigins ?? [])]),
  };
}

/** Вошедший участник глазами маршрутов данных. */
export interface Account {
  id: string;
  displayName: string;
  username: string | null;
  /** Настоящий адрес почты; у ребёнка без почты — null. */
  email: string | null;
  twoFactorEnabled: boolean;
  viewer: Viewer;
  /** Администратор без подтверждённого второго фактора: пока не включит его, данные закрыты (AUTH-3). */
  secondFactorPending: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

  // ---- Маршруты данных: нужен вошедший участник ---------------------------------------------
  /**
   * Сессия из cookie → участник. Продление сессии библиотека сообщает заголовками Set-Cookie:
   * они пересылаются клиенту, иначе cookie истекла бы раньше записи в базе.
   */
  async function currentAccount(
    request: FastifyRequest,
    reply: FastifyReply,
    options: { allowSecondFactorPending?: boolean } = {},
  ): Promise<Account | null> {
    // Изменяющие запросы принимаются только со своего происхождения: сверх SameSite=Lax.
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin ?? originOf(request.headers.referer);
      if (origin === undefined || !module.origins.has(origin)) {
        return fail(reply, 403, 'INVALID_ORIGIN', 'Request origin is not allowed');
      }
    }
    const result = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length > 0) void reply.header('set-cookie', cookies);
    const session = result.response;
    if (session === null) return fail(reply, 401, 'UNAUTHORIZED', 'Sign in required');

    const { user } = session;
    const viewer = await appDb.withAccount(user.id, (tx) => loadViewer(tx, user.id));
    const account: Account = {
      id: user.id,
      displayName: user.name,
      username: user.username ?? null,
      email: isPlaceholderEmail(user.email) ? null : user.email,
      twoFactorEnabled: user.twoFactorEnabled === true,
      viewer,
      secondFactorPending: mustUseSecondFactor(viewer) && user.twoFactorEnabled !== true,
    };
    if (account.secondFactorPending && !options.allowSecondFactorPending) {
      return fail(reply, 403, 'SECOND_FACTOR_REQUIRED', 'Enable the second factor first');
    }
    return account;
  }

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
    const until = await lockedUntil(db, account.id);
    if (until !== null) {
      void reply.header('retry-after', String(Math.ceil((until.getTime() - Date.now()) / 1000)));
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
      await recordFailure(db, account.id);
      fail(reply, 403, 'INVALID_PASSWORD', 'Wrong password');
      return false;
    }
    await clearFailures(db, account.id);
    return true;
  }

  app.get('/api/me', async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    const notices = await appDb.withAccount(account.id, (tx) =>
      tx
        .select({ id: passwordResets.id, completedAt: passwordResets.completedAt })
        .from(passwordResets)
        .where(
          and(
            sql`${passwordResets.completedAt} IS NOT NULL`,
            isNull(passwordResets.acknowledgedAt),
          ),
        ),
    );
    return {
      id: account.id,
      displayName: account.displayName,
      username: account.username,
      email: account.email,
      twoFactorEnabled: account.twoFactorEnabled,
      secondFactorRequired: account.secondFactorPending,
      roles: [...account.viewer.memberships].map(([householdId, role]) => ({ householdId, role })),
      // Ребёнок видит, что пароль сбрасывали, пока не подтвердит, что прочитал (AUTH-5).
      passwordReset: notices[0] ? { completedAt: notices[0].completedAt } : null,
    };
  });

  app.post('/api/me/password-reset/ack', async (request, reply) => {
    const account = await currentAccount(request, reply, { allowSecondFactorPending: true });
    if (account === null) return reply;
    const acknowledged = await appDb.withAccount(account.id, (tx) =>
      tx
        .update(passwordResets)
        .set({ acknowledgedAt: sql`now()` })
        .where(
          and(
            isNull(passwordResets.acknowledgedAt),
            sql`${passwordResets.completedAt} IS NOT NULL`,
          ),
        ),
    );
    return { acknowledged: acknowledged.rowCount ?? 0 };
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
    const [profile, mine] = await appDb.withAccount(account.id, (tx) =>
      Promise.all([
        tx
          .select({ displayName: accounts.displayName, username: accounts.username })
          .from(accounts),
        tx.select({ id: notes.id, title: notes.title }).from(notes),
      ]),
    );
    return { exportedAt: new Date().toISOString(), profile: profile[0] ?? null, notes: mine };
  });

  /** Пример маршрута данных за вторым фактором администратора и RLS. */
  app.get('/api/notes', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (account === null) return reply;
    return appDb.withAccount(account.id, (tx) =>
      tx
        .select({ id: notes.id, title: notes.title, spaceKind: notes.spaceKind })
        .from(notes)
        .orderBy(notes.title),
    );
  });
}

function originOf(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
