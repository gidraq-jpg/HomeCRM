// Попытки входа (AUTH-8): блокировка учётной записи после серии неудач и журнал входов.
// Библиотека ограничивает запросы по адресу и пути (rateLimit), но не знает про учётную запись:
// подбор пароля с разных адресов она не остановит. Эту часть пишем сами; работает она от имени
// службы входа (роль homecrm_auth) и в таблицах login_locks и login_events.
import {
  accounts,
  and,
  type Database,
  eq,
  gt,
  type LOGIN_KINDS,
  type LOGIN_OUTCOMES,
  loginEvents,
  loginLocks,
  sql,
} from '@homecrm/db';
import { normalizeUsername } from './identity.ts';

/** Пять неудач подряд за 15 минут — вход заблокирован на 15 минут; верный пароль счётчик сбрасывает. */
export const LOCKOUT = { maxFailures: 5, windowSeconds: 900, lockSeconds: 900 } as const;

export type LoginKind = (typeof LOGIN_KINDS)[number];
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Учётная запись по тому, что ввели при входе: имя пользователя или адрес почты. */
export async function findAccountByLogin(
  db: Database,
  login: { username?: unknown; email?: unknown },
): Promise<{ id: string } | null> {
  const condition =
    typeof login.username === 'string'
      ? eq(accounts.username, normalizeUsername(login.username))
      : typeof login.email === 'string'
        ? eq(accounts.email, login.email.trim().toLowerCase())
        : null;
  if (condition === null) return null;
  const [row] = await db.select({ id: accounts.id }).from(accounts).where(condition).limit(1);
  return row ?? null;
}

/** До какого времени вход заблокирован; null — не заблокирован. Время сравнивает база. */
export async function lockedUntil(db: Database, accountId: string): Promise<Date | null> {
  const [row] = await db
    .select({ lockedUntil: loginLocks.lockedUntil })
    .from(loginLocks)
    .where(and(eq(loginLocks.accountId, accountId), gt(loginLocks.lockedUntil, sql`now()`)));
  return row?.lockedUntil ?? null;
}

/**
 * Неудачная попытка: счётчик растёт атомарно, окно в 15 минут начинается с первой неудачи.
 * На пятой неудаче вход блокируется. Возвращает время блокировки, если она наступила.
 */
export async function recordFailure(db: Database, accountId: string): Promise<Date | null> {
  const { maxFailures, windowSeconds, lockSeconds } = LOCKOUT;
  const counted = await db.execute<{ failures: number }>(sql`
    INSERT INTO login_locks (account_id, failures, window_started_at)
    VALUES (${accountId}, 1, now())
    ON CONFLICT (account_id) DO UPDATE SET
      failures = CASE WHEN login_locks.window_started_at < now() - make_interval(secs => ${windowSeconds})
                      THEN 1 ELSE login_locks.failures + 1 END,
      window_started_at = CASE WHEN login_locks.window_started_at < now() - make_interval(secs => ${windowSeconds})
                               THEN now() ELSE login_locks.window_started_at END
    RETURNING failures`);
  if ((counted.rows[0]?.failures ?? 0) < maxFailures) return null;
  const locked = await db.execute<{ locked_until: Date }>(sql`
    UPDATE login_locks SET locked_until = now() + make_interval(secs => ${lockSeconds})
    WHERE account_id = ${accountId} RETURNING locked_until`);
  return locked.rows[0]?.locked_until ?? null;
}

/** Верный пароль: счётчик неудач и блокировка снимаются. */
export async function clearFailures(db: Database, accountId: string): Promise<void> {
  await db.delete(loginLocks).where(eq(loginLocks.accountId, accountId));
}

export async function recordLoginEvent(
  db: Database,
  event: { accountId: string; kind: LoginKind; outcome: LoginOutcome } & ClientInfo,
): Promise<void> {
  await db.insert(loginEvents).values(event);
}
