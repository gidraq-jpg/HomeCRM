// Попытки входа (AUTH-8): блокировка после серии неудач и журнал входов.
// Библиотека ограничивает запросы по адресу и пути (rateLimit), но не знает про учётную запись:
// подбор пароля с разных адресов она не остановит. Эту часть пишем сами; работает она от имени
// службы входа (роль homecrm_auth) в таблицах login_locks, login_name_attempts и login_events.
//
// Попытка занимается ДО проверки пароля (reserveAttempt), а не записывается после неё: иначе
// параллельная пачка запросов успевала бы проверить больше пяти паролей, пока ни один из них
// ещё не посчитан. Верный пароль освобождает счётчик (clearFailures).
//
// Блокировка не выдаёт, какие имена существуют: на имя, которого нет, она наступает так же и
// в те же сроки — счётчик ведётся по хэшу имени (login_name_attempts).
import {
  accounts,
  type Database,
  eq,
  type LOGIN_KINDS,
  type LOGIN_OUTCOMES,
  loginEvents,
  sql,
} from '@homecrm/db';
import { hashToken, normalizeUsername } from './identity.ts';

/** Пять попыток за 15 минут; шестая — блокировка на 15 минут. Верный пароль счётчик сбрасывает. */
export const LOCKOUT = { maxFailures: 5, windowSeconds: 900, lockSeconds: 900 } as const;

export type LoginKind = (typeof LOGIN_KINDS)[number];
export type LoginOutcome = (typeof LOGIN_OUTCOMES)[number];

export interface ClientInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

/** Кого считает счётчик: известную учётную запись или имя, которого в базе нет. */
export type AttemptSubject = { accountId: string } | { name: string };

/** Что ввели при входе: имя пользователя или адрес почты. */
export interface LoginInput {
  username?: unknown;
  email?: unknown;
}

/** Учётная запись по тому, что ввели при входе. */
export async function findAccountByLogin(
  db: Database,
  login: LoginInput,
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

/** Ключ счётчика для введённого, но неизвестного имени; null — вход без имени и почты. */
export function unknownLoginSubject(login: LoginInput): AttemptSubject | null {
  const typed =
    typeof login.username === 'string'
      ? `u:${normalizeUsername(login.username)}`
      : typeof login.email === 'string'
        ? `e:${login.email.trim().toLowerCase()}`
        : null;
  return typed === null ? null : { name: hashToken(typed) };
}

function table(subject: AttemptSubject) {
  return 'accountId' in subject
    ? { name: sql.raw('login_locks'), key: sql.raw('account_id'), value: subject.accountId }
    : { name: sql.raw('login_name_attempts'), key: sql.raw('name_hash'), value: subject.name };
}

/** До какого времени вход заблокирован; null — не заблокирован. Время сравнивает база. */
export async function lockedUntil(db: Database, subject: AttemptSubject): Promise<Date | null> {
  const t = table(subject);
  const result = await db.execute<{ locked_until: string }>(
    sql`SELECT locked_until FROM ${t.name} WHERE ${t.key} = ${t.value} AND locked_until > now()`,
  );
  const value = result.rows[0]?.locked_until;
  return value === undefined ? null : new Date(value);
}

export type Reservation = { allowed: true } | { allowed: false; lockedUntil: Date };

/**
 * Занимает попытку входа до проверки пароля. Строка счётчика блокируется на время решения
 * (SELECT ... FOR UPDATE), поэтому параллельные запросы выстраиваются в очередь и каждый видит
 * счётчик с учётом предыдущих: больше пяти проверок в окне не пройдёт ни при какой нагрузке.
 * Пятая попытка пропускается, но выставляет блокировку: шестая получит отказ, не касаясь пароля.
 */
export async function reserveAttempt(db: Database, subject: AttemptSubject): Promise<Reservation> {
  const { maxFailures, windowSeconds, lockSeconds } = LOCKOUT;
  const t = table(subject);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`INSERT INTO ${t.name} (${t.key}) VALUES (${t.value}) ON CONFLICT DO NOTHING`,
    );
    const state = await tx.execute<{
      failures: number;
      expired: boolean;
      locked: boolean;
      locked_until: string | null;
    }>(sql`
      SELECT failures,
             window_started_at < now() - make_interval(secs => ${windowSeconds}) AS expired,
             COALESCE(locked_until > now(), false) AS locked,
             locked_until
      FROM ${t.name} WHERE ${t.key} = ${t.value} FOR UPDATE`);
    const row = state.rows[0];
    if (row === undefined) throw new Error('reserveAttempt: the counter row disappeared');
    if (row.locked && row.locked_until !== null) {
      return { allowed: false, lockedUntil: new Date(row.locked_until) } as const;
    }
    const failures = row.expired ? 1 : row.failures + 1;
    const lock = failures >= maxFailures;
    await tx.execute(sql`
      UPDATE ${t.name} SET
        failures = ${failures},
        window_started_at = CASE WHEN ${row.expired} THEN now() ELSE window_started_at END,
        locked_until = CASE WHEN ${lock}
                            THEN now() + make_interval(secs => ${lockSeconds}) ELSE NULL END
      WHERE ${t.key} = ${t.value}`);
    return { allowed: true } as const;
  });
}

/** Верный пароль: счётчик попыток и блокировка снимаются. */
export async function clearFailures(db: Database, subject: AttemptSubject): Promise<void> {
  const t = table(subject);
  await db.execute(sql`DELETE FROM ${t.name} WHERE ${t.key} = ${t.value}`);
}

export async function recordLoginEvent(
  db: Database,
  event: { accountId: string; kind: LoginKind; outcome: LoginOutcome } & ClientInfo,
): Promise<void> {
  await db.insert(loginEvents).values(event);
}
