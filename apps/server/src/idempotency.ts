import { createHash } from 'node:crypto';
import { and, apiOperations, eq, sql, type Transaction } from '@homecrm/db';
import { OperationReceipt } from '@homecrm/shared';
import { Failure } from './objects/support.ts';

export function operationOwner(
  accountId: string,
  ownerAccountId: string | undefined,
  offline: boolean | undefined,
) {
  if (offline && !ownerAccountId) throw new Failure(400, 'OWNER_REQUIRED');
  if (ownerAccountId !== undefined && ownerAccountId !== accountId)
    throw new Failure(403, 'ACCOUNT_MISMATCH');
}

export async function recordVersions(tx: Transaction, table: string, ids: string[]) {
  const wanted = sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  return (
    await tx.execute<{ id: string; version: string }>(
      sql`SELECT id,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS version FROM ${sql.identifier(table)} WHERE id=ANY(${wanted})`,
    )
  ).rows;
}
/** Офлайн использует точность PostgreSQL; Date сохраняет лишь миллисекунды. */
export async function exactVersion(
  tx: Transaction,
  table: string,
  id: string,
  expected: string | undefined,
) {
  if (!expected) throw new Failure(400, 'VERSION_REQUIRED');
  const result = await tx.execute(
    sql`SELECT 1 FROM ${sql.identifier(table)} WHERE id=${id}::uuid AND updated_at=${expected}::timestamptz`,
  );
  if (!result.rowCount) throw new Failure(409, 'STALE_VERSION');
}

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
  receipt?: OperationReceipt,
) {
  if (key)
    await tx
      .insert(apiOperations)
      .values({ accountId, key, operation, fingerprint: hash, resultIds, receipt });
}

export async function receiptOf(tx: Transaction, accountId: string, key: string | undefined) {
  if (!key) return undefined;
  const [row] = await tx
    .select({ receipt: apiOperations.receipt })
    .from(apiOperations)
    .where(and(eq(apiOperations.accountId, accountId), eq(apiOperations.key, key)));
  // Старые квитанции остаются пригодны для повтора, но не для автоматической цепочки правок.
  return row?.receipt ? OperationReceipt.parse(row.receipt) : undefined;
}
export async function finishReceipt(
  tx: Transaction,
  accountId: string,
  key: string | undefined,
  operation: string,
  hash: string,
  rows: { id: string; updatedAt: Date | string }[],
  metadata: Pick<
    OperationReceipt,
    'checklist' | 'completionEventId' | 'nextTaskId' | 'warningIds'
  > & { table: string },
) {
  if (!key) return undefined;
  const { table, ...details } = metadata;
  const versions = await recordVersions(
    tx,
    table,
    rows.map((row) => row.id),
  );
  const receipt = OperationReceipt.parse({
    ownerAccountId: accountId,
    key,
    operation,
    confirmedAt: new Date().toISOString(),
    results: rows.map((row) => ({
      id: row.id,
      updatedAt: versions.find((version) => version.id === row.id)?.version,
    })),
    ...details,
  });
  await finishOperation(
    tx,
    accountId,
    key,
    operation,
    hash,
    rows.map((row) => row.id),
    receipt,
  );
  return receipt;
}
