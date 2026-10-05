// Плагин HomeCRM для Better Auth: то, чего библиотека не знает про дом (ADR-0005).
//   - принять приглашение: одна транзакция создаёт учётную запись, пароль, личное пространство
//     и членство, а приглашение отмечает принятым (AUTH-2, SPACE-1);
//   - выдать ребёнку ссылку сброса пароля — только администратор своего дома (AUTH-5);
//   - блокировка по учётной записи и журнал входов вокруг входа и второго фактора (AUTH-8);
//   - администратору нельзя выключить второй фактор (AUTH-3).
// Маршруты плагина живут в маршрутизаторе библиотеки (/api/auth/homecrm/...), поэтому на них
// действуют её защита от CSRF, ограничение запросов и проверка сессии.
import { randomBytes } from 'node:crypto';
import { type Database, eq, invitations, passwordResets, sql } from '@homecrm/db';
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
  lockedUntil,
  recordFailure,
  recordLoginEvent,
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

/** Заголовок с адресом клиента: его ставит только наш Fastify (fastify.ts), чужой заголовок затирается. */
export const CLIENT_IP_HEADER = 'x-homecrm-client-ip';

/** Ссылка сброса пароля ребёнку живёт сутки: администратор передаёт её через мессенджер. */
export const CHILD_RESET_LINK_TTL_MS = 24 * 60 * 60 * 1000;

const SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/username', '/sign-in/email']);
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set([
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
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

function retryAfterSeconds(until: Date): string {
  return String(Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)));
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

          const passwordHash = await ctx.context.password.hash(password);
          const tokenHash = hashToken(token);
          let created: { id: string; householdId: string; role: string };
          try {
            created = await deps.db.transaction(async (tx) => {
              const [invitation] = await tx
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

              const account = await insertAccount(tx, {
                username,
                displayName,
                passwordHash,
                email,
                householdId: invitation.householdId,
                role: invitation.role,
              });
              // Политика службы входа разрешает отметить только живое приглашение: если соседний
              // запрос успел раньше, строк не найдётся, а вся транзакция откатится.
              const accepted = await tx
                .update(invitations)
                .set({ acceptedAt: sql`now()`, acceptedBy: account.id })
                .where(eq(invitations.id, invitation.id));
              if (accepted.rowCount !== 1) throw new InvitationError('INVITATION_USED');
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
          matcher: (context) => SIGN_IN_PATHS.has(context.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const body = (ctx.body ?? {}) as { username?: unknown; email?: unknown };
            // Служебный адрес ребёнка — не способ входа: ответ такой же, как на неверный пароль.
            if (typeof body.email === 'string' && isPlaceholderEmail(body.email)) {
              throw APIError.from('UNAUTHORIZED', {
                code: 'INVALID_EMAIL_OR_PASSWORD',
                message: 'Invalid email or password',
              });
            }
            const account = await findAccountByLogin(deps.db, body);
            if (account === null) return;
            const until = await lockedUntil(deps.db, account.id);
            if (until === null) return;
            await journal(deps, ctx.context.logger, {
              accountId: account.id,
              kind: 'sign_in',
              outcome: 'locked',
              ...clientInfo(ctx),
            });
            const seconds = retryAfterSeconds(until);
            throw new APIError(
              'TOO_MANY_REQUESTS',
              { code: 'ACCOUNT_TEMPORARILY_LOCKED', message: 'Too many attempts, try later' },
              { 'Retry-After': seconds, 'X-Retry-After': seconds },
            );
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
            const account = await findAccountByLogin(
              deps.db,
              (ctx.body ?? {}) as { username?: unknown; email?: unknown },
            );
            if (account === null) return;
            const returned = ctx.context.returned;
            const info = clientInfo(ctx);
            if (isAPIError(returned)) {
              // Блокировка и сбои сервера подбором не считаются: только неверные учётные данные.
              if (returned.statusCode !== 401) return;
              await recordFailure(deps.db, account.id);
              await journal(deps, ctx.context.logger, {
                accountId: account.id,
                kind: 'sign_in',
                outcome: 'failure',
                ...info,
              });
              return;
            }
            await clearFailures(deps.db, account.id);
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
