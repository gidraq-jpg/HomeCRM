import { createHash } from 'node:crypto';
import { and, apiOperations, eq, sql, type Transaction } from '@homecrm/db';
import { Failure } from './objects/support.ts';

export const fingerprint = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Блокировка ключа предшествует блокировкам записей. Результат фиксируется той же транзакцией. */
export async function beginOperation(
  tx: Transaction,
  accountId: string,
  key: string | undefined,
  operation: string,
  hash: string,
) {
  if (!key) return null;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`api:${accountId}:${key}`},0))`,
  );
  const [prior] = await tx
    .select()
    .from(apiOperations)
    .where(and(eq(apiOperations.accountId, accountId), eq(apiOperations.key, key)));
  if (prior && (prior.operation !== operation || prior.fingerprint !== hash))
    throw new Failure(409, 'IDEMPOTENCY_CONFLICT');
  return prior?.resultIds ?? null;
}
export async function finishOperation(
  tx: Transaction,
  accountId: string,
  key: string | undefined,
  operation: string,
  hash: string,
  resultIds: string[],
) {
  if (key)
    await tx
      .insert(apiOperations)
      .values({ accountId, key, operation, fingerprint: hash, resultIds });
}
