// Повторный ввод пароля перед чувствительным действием (AUTH-7).
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Account } from './account.ts';
import { clearFailures, reserveAttempt } from './attempts.ts';
import type { AuthModule } from './routes.ts';

function fail(reply: FastifyReply, status: number, code: string, message: string): false {
  void reply.code(status).send({ code, message });
  return false;
}

/** Проверяет пароль вошедшего участника; неверные пароли копятся в блокировку. Ответ об отказе уже отправлен. */
export function createPasswordConfirmation({ auth, db }: Pick<AuthModule, 'auth' | 'db'>) {
  return async function confirmPassword(
    request: FastifyRequest,
    reply: FastifyReply,
    account: Account,
    password: unknown,
  ): Promise<boolean> {
    if (typeof password !== 'string' || password.length === 0)
      return fail(reply, 400, 'PASSWORD_REQUIRED', 'Enter your password to continue');
    // Попытка занимается до проверки пароля (attempts.ts): параллельные запросы не обгонят счётчик.
    const reservation = await reserveAttempt(db, { accountId: account.id });
    if (!reservation.allowed) {
      const seconds = Math.max(
        1,
        Math.ceil((reservation.lockedUntil.getTime() - Date.now()) / 1000),
      );
      void reply.header('retry-after', String(seconds));
      return fail(reply, 429, 'ACCOUNT_TEMPORARILY_LOCKED', 'Too many attempts, try later');
    }
    try {
      await auth.api.verifyPassword({
        headers: fromNodeHeaders(request.headers),
        body: { password },
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
      return fail(reply, 403, 'INVALID_PASSWORD', 'Wrong password');
    }
    await clearFailures(db, { accountId: account.id });
    return true;
  };
}
