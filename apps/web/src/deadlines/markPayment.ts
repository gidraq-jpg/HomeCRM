import type { Payment } from '../charges/api.ts';

// Отмена отметки оплаты в радаре (DEAD-4, UTIL-10). Отметка по начислению создаёт оплату на
// остаток, но ответ сервера не говорит, создана ли она: при нулевом остатке не создаётся ничего,
// а рядом могла появиться оплата другого участника. Поэтому отменяется только оплата, которой не
// было до отметки и которую внёс сам участник, и только если такая оплата ровно одна.

/** Идентификаторы живых оплат: слепок «до» отметки. */
export function liveIds(payments: readonly Payment[]): ReadonlySet<string> {
  return new Set(payments.filter((payment) => payment.cancelledAt === null).map((p) => p.id));
}

/** Новая оплата самого участника: ровно одна — она и есть результат отметки; иначе `null`. */
export function ownNewPayment(
  before: ReadonlySet<string>,
  after: readonly Payment[],
  meId: string,
): Payment | null {
  const fresh = after.filter(
    (payment) =>
      payment.cancelledAt === null && !before.has(payment.id) && payment.authorId === meId,
  );
  return fresh.length === 1 ? (fresh[0] ?? null) : null;
}

/** Что показать после отметки по начислению. */
export type MarkOutcome =
  | { kind: 'created'; paymentId: string }
  /** Новых оплат нет: начисление уже было оплачено. */
  | { kind: 'already-paid' }
  /** Слепка нет или новых оплат не одна: что именно записано, неизвестно, отменять нечего. */
  | { kind: 'unknown' };

export function markOutcome(
  before: ReadonlySet<string> | null,
  after: readonly Payment[],
  meId: string,
): MarkOutcome {
  if (before === null) return { kind: 'unknown' };
  const own = ownNewPayment(before, after, meId);
  if (own !== null) return { kind: 'created', paymentId: own.id };
  const anyNew = after.some((payment) => payment.cancelledAt === null && !before.has(payment.id));
  return anyNew ? { kind: 'unknown' } : { kind: 'already-paid' };
}
