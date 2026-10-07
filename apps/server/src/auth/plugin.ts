// Плагин HomeCRM для Better Auth: то, чего библиотека не знает про дом (ADR-0005).
//   - принять приглашение: одна транзакция создаёт учётную запись, пароль, личное пространство
//     и членство, а приглашение отмечает принятым (AUTH-2, SPACE-1);
//   - выдать ребёнку ссылку сброса пароля — только администратор своего дома (AUTH-5);
//   - блокировка по учётной записи и журнал входов вокруг входа и второго фактора (AUTH-8);
//   - администратору нельзя выключить второй фактор (AUTH-3).
// Маршруты плагина живут в маршрутизаторе библиотеки (/api/auth/homecrm/...), поэтому на них
// действуют её защита от CSRF, ограничение запросов и проверка сессии.
import { randomBytes } from 'node:crypto';
import { type Database, eq, invitations, passwordResets, sql, type Transaction } from '@homecrm/db';
import { canResetPassword, mustUseSecondFactor } from '@homecrm/shared';
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  getSessionFromCtx,
  isAPIError,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import {
  type ClientInfo,
  clearFailures,
  findAccountByLogin,
  type LoginKind,
  type LoginOutcome,
  loginInput,
  recordLoginEvent,
  reserveAttempt,
  unknownLoginSubject,
} from './attempts.ts';
import {
  hashToken,
  INVITATION_TOKEN,
  isPlaceholderEmail,
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX,
  USERNAME_MIN,
} from './identity.ts';
import { insertAccount, loadViewer, pgError } from './provision.ts';
import { checkRequestSource } from './request-source.ts';
import { claimTotpCode } from './totp-replay.ts';

/** Заголовок с адресом клиента: его ставит только наш Fastify (fastify.ts), чужой заголовок затирается. */
export const CLIENT_IP_HEADER = 'x-homecrm-client-ip';

/** Ссылка сброса пароля ребёнку живёт сутки: администратор передаёт её через мессенджер. */
export const CHILD_RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/username', '/sign-in/email']);
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
]);
/**
 * Маршруты библиотеки, где человек повторно вводит пароль (AUTH-7). Тот, кто украл cookie, может
 * подбирать пароль и здесь, поэтому неверный пароль считается попыткой так же, как при входе.
 */
const PASSWORD_CONFIRM_PATHS: ReadonlySet<string> = new Set([
  '/change-password',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/get-totp-uri',
  '/two-factor/generate-backup-codes',
]);
/** Имя cookie незавершённого входа со вторым фактором в библиотеке (без префикса). */
const TWO_FACTOR_COOKIE = 'two_factor';

export interface PluginDeps {
  /** База службы входа (роль homecrm_auth). */
  db: Database;
  /** Происхождение приложения для ссылок: https://home.example. */
  baseURL: string;
}

const AcceptBody = z.object({
  token: z.string().regex(INVITATION_TOKEN),
  username: z.string().max(100),
  displayName: z.string().trim().min(1).max(60),
  password: z.string().max(1000),
  email: z.email().max(254).optional(),
});

const ResetLinkBody = z.object({ accountId: z.uuid() });

/** Приглашение нельзя принять: нет такого, уже принято, отозвано или истекло. */
class InvitationError extends Error {
  readonly code:
    | 'INVITATION_NOT_FOUND'
    | 'INVITATION_USED'
    | 'INVITATION_REVOKED'
    | 'INVITATION_EXPIRED';
  constructor(code: InvitationError['code']) {
    super(code);
    this.code = code;
  }
}

function clientInfo(ctx: {
  request?: Request | undefined;
  headers?: Headers | undefined;
}): ClientInfo {
  const headers = ctx.request?.headers ?? ctx.headers;
  return {
    ipAddress: headers?.get(CLIENT_IP_HEADER) ?? null,
    userAgent: headers?.get('user-agent') ?? null,
  };
}

/** Приглашение по хэшу ссылки; если его нельзя принять, говорит почему. */
async function readLiveInvitation(db: Database | Transaction, tokenHash: string) {
  const [invitation] = await db
    .select({
      id: invitations.id,
      householdId: invitations.householdId,
      role: invitations.role,
      accepted: sql<boolean>`${invitations.acceptedAt} IS NOT NULL`,
      revoked: sql<boolean>`${invitations.revokedAt} IS NOT NULL`,
      expired: sql<boolean>`${invitations.expiresAt} <= now()`,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, tokenHash));
  if (invitation === undefined) throw new InvitationError('INVITATION_NOT_FOUND');
  if (invitation.accepted) throw new InvitationError('INVITATION_USED');
  if (invitation.revoked) throw new InvitationError('INVITATION_REVOKED');
  if (invitation.expired) throw new InvitationError('INVITATION_EXPIRED');
  return invitation;
}

/** Журнал не должен ломать вход: сбой записи попадает в журнал сервера, а не к пользователю. */
async function journal(
  deps: PluginDeps,
  logger: { error: (message: string, ...args: unknown[]) => void },
  event: { accountId: string; kind: LoginKind; outcome: LoginOutcome } & ClientInfo,
): Promise<void> {
  try {
    await recordLoginEvent(deps.db, event);
  } catch (error) {
    logger.error('Failed to write the login journal', error);
  }
}

export function lockedError(until: Date): APIError {
  const seconds = String(Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)));
  return new APIError(
    'TOO_MANY_REQUESTS',
    { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'Too many attempts, try later' },
    { 'Retry-After': seconds, 'X-Retry-After': seconds },
  );
}

export function homecrm(deps: PluginDeps) {
  return {
    id: 'homecrm',
    endpoints: {
      acceptInvitation: createAuthEndpoint(
        '/homecrm/invitation/accept',
        { method: 'POST', body: AcceptBody },
        async (ctx) => {
          const { token, username, displayName, password, email } = ctx.body;
          const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
          if (password.length < minPasswordLength) {
            throw APIError.from('BAD_REQUEST', {
              code: 'PASSWORD_TOO_SHORT',
              message: 'Password too short',
            });
          }
          if (password.length > maxPasswordLength) {
            throw APIError.from('BAD_REQUEST', {
              code: 'PASSWORD_TOO_LONG',
              message: 'Password too long',
            });
          }
          if (
            username.length < USERNAME_MIN ||
            username.length > USERNAME_MAX ||
            !isValidUsername(username)
          ) {
            throw APIError.from('BAD_REQUEST', {
              code: 'INVALID_USERNAME',
              message: 'Invalid username',
            });
          }
          if (email !== undefined && isPlaceholderEmail(email)) {
            throw APIError.from('BAD_REQUEST', { code: 'INVALID_EMAIL', message: 'Invalid email' });
          }

          const tokenHash = hashToken(token);
          let created: { id: string; householdId: string; role: string };
          try {
            // Сначала дешёвая проверка: на выдуманную ссылку не тратим 64 МиБ и 90 мс на хэш пароля.
            await readLiveInvitation(deps.db, tokenHash);
            const passwordHash = await ctx.context.password.hash(password);
            created = await deps.db.transaction(async (tx) => {
              // Ещё раз внутри транзакции: пока считался хэш, приглашение могли принять или отозвать.
              const invitation = await readLiveInvitation(tx, tokenHash);
              const account = await insertAccount(tx, {
                username,
                displayName,
                passwordHash,
                email,
                householdId: invitation.householdId,
                role: invitation.role,
                // Политика службы входа разрешает отметить только живое приглашение: если соседний
                // запрос успел раньше, строк не найдётся, а вся транзакция откатится. Отметка идёт
                // до вставки участника: база сверяет с ней дом и роль нового участника.
                beforeMembership: async (inner, accountId) => {
                  const accepted = await inner
                    .update(invitations)
                    .set({ acceptedAt: sql`now()`, acceptedBy: accountId })
                    .where(eq(invitations.id, invitation.id));
                  if (accepted.rowCount !== 1) throw new InvitationError('INVITATION_USED');
                },
              });
              return {
                id: account.id,
                householdId: invitation.householdId,
                role: invitation.role,
              };
            });
          } catch (error) {
            if (error instanceof InvitationError) {
              throw APIError.from(error.code === 'INVITATION_NOT_FOUND' ? 'NOT_FOUND' : 'GONE', {
                code: error.code,
                message: 'Invitation is not valid',
              });
            }
            const { code, constraint } = pgError(error);
            if (code === '23505') {
              const taken = constraint === 'accounts_email_key' ? 'EMAIL' : 'USERNAME';
              throw APIError.from('CONFLICT', {
                code: `${taken}_ALREADY_TAKEN`,
                message: `${taken === 'EMAIL' ? 'Email' : 'Username'} is already taken`,
              });
            }
            throw error;
          }

          const user = await ctx.context.internalAdapter.findUserById(created.id);
          const session = await ctx.context.internalAdapter.createSession(created.id);
          if (user === null || !session) {
            throw APIError.from('INTERNAL_SERVER_ERROR', {
              code: 'FAILED_TO_CREATE_SESSION',
              message: 'Failed to create session',
            });
          }
          await setSessionCookie(ctx, { session, user });
          await journal(deps, ctx.context.logger, {
            accountId: created.id,
            kind: 'sign_in',
            outcome: 'success',
            ...clientInfo(ctx),
          });
          return ctx.json({
            id: created.id,
            username: normalizeUsername(username),
            displayName: user.name,
            householdId: created.householdId,
            role: created.role,
          });
        },
      ),

      createChildResetLink: createAuthEndpoint(
        '/homecrm/child-reset-link',
        { method: 'POST', body: ResetLinkBody, use: [sensitiveSessionMiddleware] },
        async (ctx) => {
          const admin = ctx.context.session.user;
          const [adminViewer, target] = await Promise.all([
            loadViewer(deps.db, admin.id),
            loadViewer(deps.db, ctx.body.accountId),
          ]);
          if (mustUseSecondFactor(adminViewer) && !admin.twoFactorEnabled) {
            throw APIError.from('FORBIDDEN', {
              code: 'SECOND_FACTOR_REQUIRED',
              message: 'Enable the second factor first',
            });
          }
          // Тот же ответ на «нет такого участника» и «не ваш и не ребёнок»: список участников чужого дома не раскрывается.
          if (!canResetPassword(adminViewer, target)) {
            throw APIError.from('FORBIDDEN', {
              code: 'RESET_NOT_ALLOWED',
              message: 'Only a child of your household can be reset',
            });
          }
          const expiresAt = new Date(Date.now() + CHILD_RESET_LINK_TTL_MS);
          try {
            // База проверяет правило ещё раз: политика password_resets_auth_insert (canResetPasswordSql).
            await deps.db
              .insert(passwordResets)
              .values({ accountId: target.accountId, requestedBy: admin.id, expiresAt });
          } catch (error) {
            if (pgError(error).code === '42501') {
              throw APIError.from('FORBIDDEN', {
                code: 'RESET_NOT_ALLOWED',
                message: 'Only a child of your household can be reset',
              });
            }
            throw error;
          }
          // Действует только последняя выданная ссылка: прежние отзываются, чтобы не копились живые.
          await ctx.context.adapter.deleteMany({
            model: 'verification',
            where: [
              { field: 'value', value: target.accountId },
              { field: 'identifier', operator: 'starts_with', value: 'reset-password:' },
            ],
          });
          // Саму ссылку и её одноразовость обслуживает библиотека: её POST /reset-password.
          const resetToken = randomBytes(24).toString('base64url');
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: `reset-password:${resetToken}`,
            value: target.accountId,
            expiresAt,
          });
          return ctx.json({
            url: `${deps.baseURL}/reset-password?token=${resetToken}`,
            token: resetToken,
            expiresAt: expiresAt.toISOString(),
          });
        },
      ),
    },

    hooks: {
      before: [
        {
          // Библиотека сверяет Origin, только когда в запросе есть cookie, а вход идёт без неё:
          // страница на чужом сайте могла бы войти в браузере человека под чужой учётной записью
          // (login CSRF). Поэтому присланный Origin проверяется всегда, как и заголовки Fetch Metadata.
          matcher: (context) => context.request !== undefined && context.request.method !== 'GET',
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.request?.headers;
            if (headers === undefined) return;
            const error = checkRequestSource(headers, (origin) =>
              ctx.context.isTrustedOrigin(origin),
            );
            if (error !== null) throw APIError.from('FORBIDDEN', error);
          }),
        },
        {
          matcher: (context) => SIGN_IN_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const login = loginInput(ctx.path, ctx.body);
            if (login === null) return;
            // Служебный адрес ребёнка — не способ входа: ответ такой же, как на неверный пароль.
            if (login.kind === 'email' && isPlaceholderEmail(login.value)) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'INVALID_EMAIL_OR_PASSWORD',
                message: 'Invalid email or password',
              });
            }
            // Попытка занимается до проверки пароля: параллельные запросы выстраиваются в очередь
            // на строке счётчика. Для имени, которого нет, счётчик свой — отказ приходит так же,
            // и по блокировке нельзя узнать, есть ли такое имя (AUTH-8).
            const account = await findAccountByLogin(deps.db, login);
            const subject =
              account === null ? unknownLoginSubject(login) : { accountId: account.id };
            const reservation = await reserveAttempt(deps.db, subject);
            if (reservation.allowed) return;
            if (account !== null) {
              await journal(deps, ctx.context.logger, {
                accountId: account.id,
                kind: 'sign_in',
                outcome: 'locked',
                ...clientInfo(ctx),
              });
            }
            throw lockedError(reservation.lockedUntil);
          }),
        },
        {
          // Решение владельца: «доверять устройству» администратору запрещено — код TOTP у него
          // спрашивается при каждом входе (AUTH-3). Остальным — 30 дней, как в библиотеке.
          matcher: (context) =>
            SIGN_IN_PATHS.has(context.path ?? '') || SECOND_FACTOR_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const path = ctx.path ?? '';
            let accountId: string | undefined;
            if (SIGN_IN_PATHS.has(path)) {
              const login = loginInput(path, ctx.body);
              if (login === null) return;
              accountId = (await findAccountByLogin(deps.db, login))?.id;
            } else {
              accountId = (await getSessionFromCtx(ctx))?.user.id;
              if (accountId === undefined) {
                const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
                const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
                if (challenge) {
                  accountId = (await ctx.context.internalAdapter.findVerificationValue(challenge))
                    ?.value;
                }
              }
            }
            if (accountId === undefined) return;
            if (!mustUseSecondFactor(await loadViewer(deps.db, accountId))) return;
            if (SIGN_IN_PATHS.has(path)) {
              // Cookie доверия, выданная раньше, администратору не помогает: убирается из запроса.
              const trust = ctx.context.createAuthCookie('trust_device').name;
              const kept = (ctx.request?.headers.get('cookie') ?? '')
                .split(';')
                .map((part) => part.trim())
                .filter((part) => part !== '' && !part.startsWith(`${trust}=`));
              const headers = new Headers(ctx.request?.headers);
              headers.set('cookie', kept.join('; '));
              return { context: { headers } };
            }
            return { context: { body: { ...(ctx.body as object), trustDevice: false } } };
          }),
        },
        {
          // Код TOTP принимается один раз: повтор в том же окне — отказ (RFC 6238, п. 5.2).
          matcher: (context) => context.path === '/two-factor/verify-totp',
          handler: createAuthMiddleware(async (ctx) => {
            const code = (ctx.body as { code?: unknown } | undefined)?.code;
            if (typeof code !== 'string') return;
            let accountId = (await getSessionFromCtx(ctx))?.user.id;
            if (accountId === undefined) {
              const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
              const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
              if (challenge) {
                accountId = (await ctx.context.internalAdapter.findVerificationValue(challenge))
                  ?.value;
              }
            }
            if (accountId === undefined) return;
            if (await claimTotpCode(deps.db, accountId, code, ctx.context.secret)) return;
            throw APIError.from('UNAUTHORIZED', {
              code: 'INVALID_CODE',
              message: 'Invalid code',
            });
          }),
        },
        {
          // Заблокированная учётная запись не проверяет пароль ни при входе, ни при подтверждении.
          matcher: (context) => PASSWORD_CONFIRM_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            // Неверный пароль на этих путях копится в блокировку, как при входе: тот, кто украл
            // cookie, не должен подбирать пароль без ограничений. Считается только запрос с паролем.
            // Пароль приходит в поле password, а при смене пароля — в currentPassword.
            const body = (ctx.body ?? {}) as { password?: unknown; currentPassword?: unknown };
            if (typeof body.password !== 'string' && typeof body.currentPassword !== 'string')
              return;
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const reservation = await reserveAttempt(deps.db, { accountId: session.user.id });
            if (!reservation.allowed) throw lockedError(reservation.lockedUntil);
          }),
        },
        {
          // Второй фактор администратору не выключить: он обязателен (AUTH-3).
          matcher: (context) => context.path === '/two-factor/disable',
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (!session) return;
            const viewer = await loadViewer(deps.db, session.user.id);
            if (mustUseSecondFactor(viewer)) {
              throw APIError.from('FORBIDDEN', {
                code: 'SECOND_FACTOR_REQUIRED_FOR_ADMIN',
                message: 'The second factor cannot be disabled for an administrator',
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) => SIGN_IN_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const login = loginInput(ctx.path, ctx.body);
            if (login === null) return;
            const account = await findAccountByLogin(deps.db, login);
            if (account === null) return;
            const returned = ctx.context.returned;
            const info = clientInfo(ctx);
            if (isAPIError(returned)) {
              // Попытка уже посчитана до проверки; в журнал идут только неверные учётные данные.
              if (returned.statusCode !== 401) return;
              await journal(deps, ctx.context.logger, {
                accountId: account.id,
                kind: 'sign_in',
                outcome: 'failure',
                ...info,
              });
              return;
            }
            await clearFailures(deps.db, { accountId: account.id });
            const pending =
              typeof returned === 'object' &&
              returned !== null &&
              (returned as { twoFactorRedirect?: unknown }).twoFactorRedirect === true;
            await journal(deps, ctx.context.logger, {
              accountId: account.id,
              kind: 'sign_in',
              outcome: pending ? 'second_factor_required' : 'success',
              ...info,
            });
            if (pending) {
              // Клиент пока без сессии и не может прочитать /api/me. Флаг нужен, чтобы не
              // предлагать администратору доверие устройству. Только после верного пароля.
              return ctx.json({
                ...(returned as object),
                trustDeviceAllowed: !mustUseSecondFactor(await loadViewer(deps.db, account.id)),
              });
            }
          }),
        },
        {
          matcher: (context) => PASSWORD_CONFIRM_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            const userId = ctx.context.session?.user.id;
            if (userId === undefined) return;
            // Пароль подтверждён: счётчик попыток сброшен. Неверный остаётся посчитанным.
            if (!isAPIError(returned)) await clearFailures(deps.db, { accountId: userId });
          }),
        },
        {
          matcher: (context) => SECOND_FACTOR_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned;
            const success = !isAPIError(returned);
            // При входе человек ещё без сессии: кто он, видно по cookie незавершённого входа.
            let accountId: string | undefined =
              ctx.context.newSession?.user.id ?? ctx.context.session?.user.id;
            if (accountId === undefined) {
              const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
              const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
              if (challenge) {
                const pending = await ctx.context.internalAdapter.findVerificationValue(challenge);
                accountId = pending?.value;
              }
            }
            if (accountId === undefined) return;
            await journal(deps, ctx.context.logger, {
              accountId,
              kind: 'second_factor',
              outcome: success ? 'success' : 'failure',
              ...clientInfo(ctx),
            });
          }),
        },
      ],
    },

    rateLimit: [
      // Приглашение и сброс — не чаще десяти раз за 15 минут с одного адреса.
      {
        pathMatcher: (path: string) => path === '/homecrm/invitation/accept',
        window: 900,
        max: 10,
      },
      { pathMatcher: (path: string) => path === '/homecrm/child-reset-link', window: 900, max: 10 },
    ],
  } satisfies BetterAuthPlugin;
}
