// Одна проверка сессии, происхождения и обязательного TOTP для всех API данных.
import { mustUseSecondFactor, type Viewer } from '@homecrm/shared';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isPlaceholderEmail } from './identity.ts';
import { loadViewer } from './provision.ts';
import type { AuthModule } from './routes.ts';
/** Вошедший участник глазами маршрутов данных. */
export interface Account {
  id: string;
  /** Идентификатор текущего устройства, без токена сессии. */
  sessionId: string;
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
export function createAccountReader(module: AuthModule) {
  const { auth, appDb } = module;
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
      sessionId: session.session.id,
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

  return currentAccount;
}
function originOf(referer: string | undefined): string | undefined {
  if (referer === undefined) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
