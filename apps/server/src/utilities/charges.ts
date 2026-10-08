import {
  and,
  eq,
  isNull,
  objectFiles,
  recordLinks,
  sql,
  type Transaction,
  utilityAccounts,
  utilityCharges,
  utilityPayments,
} from '@homecrm/db';
import {
  CancellationInput,
  ChargeInput,
  canView,
  chargeDueOn,
  PaymentInput,
} from '@homecrm/shared';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { getObject } from '../objects/routes.ts';
import {
  columnsOf,
  type DataRoute,
  deny,
  Failure,
  missing,
  parse,
  placementOf,
  requireWrite,
} from '../objects/support.ts';
import { publicRecord } from './service.ts';

const Id = z.strictObject({ id: z.uuid() });
const List = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50000).default(0),
});
export async function financialAccount(
  tx: Transaction,
  account: Account,
  id: string,
  write = false,
) {
  let [row] = await tx.select().from(utilityAccounts).where(eq(utilityAccounts.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  const parent = await getObject(tx, account, row.parentId, write);
  if (write) {
    requireWrite(account, parent);
    [row] = await tx.select().from(utilityAccounts).where(eq(utilityAccounts.id, id)).for('update');
    if (!row) missing();
    requireWrite(account, row, 'utility_account');
  }
  return row;
}
export async function getCharge(tx: Transaction, account: Account, id: string, write = false) {
  let [row] = await tx.select().from(utilityCharges).where(eq(utilityCharges.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  await financialAccount(tx, account, row.parentId, write);
  if (write) {
    [row] = await tx.select().from(utilityCharges).where(eq(utilityCharges.id, id)).for('update');
    if (!row) missing();
    requireWrite(account, row, 'utility_charge');
  }
  return row;
}
async function receipt(
  tx: Transaction,
  account: Account,
  parent: typeof utilityAccounts.$inferSelect,
  table: 'utility_charges' | 'utility_payments',
  id: string,
  receiptId: string | null,
) {
  if (!receiptId) return;
  const [file] = await tx.select().from(objectFiles).where(eq(objectFiles.id, receiptId));
  if (
    !file ||
    file.parentId !== parent.parentId ||
    file.deletedAt ||
    !canView(account.viewer, placementOf(file))
  )
    missing();
  await tx.insert(recordLinks).values({
    leftTable: table,
    leftId: id,
    rightTable: 'object_files',
    rightId: file.id,
    role: 'receipt',
    authorId: account.id,
  });
}
async function receiptIds(tx: Transaction, table: string, id: string) {
  const result = await tx.execute<{
    id: string;
  }>(sql`SELECT f.id FROM record_links l JOIN object_files f ON f.id=l.right_id
    WHERE l.left_table=${table} AND l.left_id=${id}::uuid AND l.role='receipt' AND l.right_table='object_files' AND l.deleted_at IS NULL AND f.deleted_at IS NULL ORDER BY f.id`);
  return result.rows.map((r) => r.id);
}
export async function chargeSummary(tx: Transaction, row: typeof utilityCharges.$inferSelect) {
  const result = await tx.execute<{ paid: string }>(
    sql`SELECT coalesce(sum(amount_cents),0)::text AS paid FROM utility_payments WHERE parent_id=${row.id}::uuid AND cancelled_at IS NULL AND deleted_at IS NULL`,
  );
  const paid = BigInt(result.rows[0]?.paid ?? '0');
  if (paid > BigInt(Number.MAX_SAFE_INTEGER)) throw new Failure(409, 'PAYMENT_TOTAL_TOO_LARGE');
  return {
    ...publicRecord(row),
    parentId: row.parentId,
    period: row.period,
    totalCents: row.totalCents,
    lines: row.lines,
    dueOn: row.dueOn,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    paidCents: Number(paid),
    remainingCents: Number(BigInt(row.totalCents) > paid ? BigInt(row.totalCents) - paid : 0n),
    receiptIds: await receiptIds(tx, 'utility_charges', row.id),
  };
}
async function paymentSummary(tx: Transaction, row: typeof utilityPayments.$inferSelect) {
  return {
    ...publicRecord(row),
    parentId: row.parentId,
    paidOn: row.paidOn,
    amountCents: row.amountCents,
    payer: row.payer,
    method: row.method,
    cancelledAt: row.cancelledAt,
    cancellationReason: row.cancellationReason,
    receiptIds: await receiptIds(tx, 'utility_payments', row.id),
  };
}
export async function createPayment(
  tx: Transaction,
  account: Account,
  charge: typeof utilityCharges.$inferSelect,
  input: PaymentInput,
) {
  if (charge.cancelledAt) throw new Failure(409, 'CHARGE_CANCELLED');
  const parent = await financialAccount(tx, account, charge.parentId, true);
  const current = await chargeSummary(tx, charge);
  if (BigInt(current.paidCents) + BigInt(input.amountCents) > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Failure(409, 'PAYMENT_TOTAL_TOO_LARGE');
  const [row] = await tx
    .insert(utilityPayments)
    .values({
      ...columnsOf(placementOf(charge)),
      parentId: charge.id,
      authorId: account.id,
      title: 'Оплата',
      paidOn: input.paidOn,
      amountCents: input.amountCents,
      payer: input.payer,
      method: input.method,
    })
    .returning();
  if (!row) deny();
  await receipt(tx, account, parent, 'utility_payments', row.id, input.receiptId);
  return paymentSummary(tx, row);
}
export async function chargeRoutes(route: DataRoute) {
  route('POST', '/api/accounts/:id/charges', 201, async (tx, account, request) => {
    const body = parse(ChargeInput, request.body);
    const parent = await financialAccount(tx, account, parse(Id, request.params).id, true);
    const dueOn = body.dueOn ?? chargeDueOn(body.period, parent.data.paymentRule);
    if (!dueOn) throw new Failure(400, 'DUE_DATE_REQUIRED');
    const [row] = await tx
      .insert(utilityCharges)
      .values({
        ...columnsOf(placementOf(parent)),
        parentId: parent.id,
        authorId: account.id,
        title: `Начисление за ${body.period}`,
        period: body.period,
        totalCents: body.totalCents,
        lines: body.lines,
        dueOn,
      })
      .returning();
    if (!row) deny();
    await receipt(tx, account, parent, 'utility_charges', row.id, body.receiptId);
    return chargeSummary(tx, row);
  });
  route('GET', '/api/accounts/:id/charges', 200, async (tx, account, request) => {
    const parent = await financialAccount(tx, account, parse(Id, request.params).id);
    const query = parse(List, request.query);
    const rows = await tx
      .select()
      .from(utilityCharges)
      .where(and(eq(utilityCharges.parentId, parent.id), isNull(utilityCharges.deletedAt)))
      .orderBy(utilityCharges.period, utilityCharges.id)
      .limit(query.limit)
      .offset(query.offset);
    const items = [];
    for (const row of rows) items.push(await chargeSummary(tx, row));
    return items;
  });
  route('GET', '/api/charges/:id', 200, async (tx, account, request) =>
    chargeSummary(tx, await getCharge(tx, account, parse(Id, request.params).id)),
  );
  route('POST', '/api/charges/:id/payments', 201, async (tx, account, request) => {
    const body = parse(PaymentInput, request.body);
    return createPayment(
      tx,
      account,
      await getCharge(tx, account, parse(Id, request.params).id, true),
      body,
    );
  });
  route('GET', '/api/charges/:id/payments', 200, async (tx, account, request) => {
    const charge = await getCharge(tx, account, parse(Id, request.params).id);
    const query = parse(List, request.query);
    const rows = await tx
      .select()
      .from(utilityPayments)
      .where(and(eq(utilityPayments.parentId, charge.id), isNull(utilityPayments.deletedAt)))
      .orderBy(utilityPayments.paidOn, utilityPayments.id)
      .limit(query.limit)
      .offset(query.offset);
    const items = [];
    for (const row of rows) items.push(await paymentSummary(tx, row));
    return items;
  });
  for (const type of ['charges', 'payments'] as const) {
    route('POST', `/api/${type}/:id/cancel`, 200, async (tx, account, request) => {
      const { reason } = parse(CancellationInput, request.body);
      const id = parse(Id, request.params).id;
      if (type === 'charges') {
        const row = await getCharge(tx, account, id, true);
        if (!row.cancelledAt) {
          const paid = await chargeSummary(tx, row);
          if (paid.paidCents > 0) throw new Failure(409, 'CANCEL_PAYMENTS_FIRST');
          const [updated] = await tx
            .update(utilityCharges)
            .set({ cancelledAt: new Date(), cancellationReason: reason })
            .where(eq(utilityCharges.id, id))
            .returning();
          if (!updated) deny();
          return chargeSummary(tx, updated);
        }
        return chargeSummary(tx, row);
      }
      let [row] = await tx.select().from(utilityPayments).where(eq(utilityPayments.id, id));
      if (!row || !canView(account.viewer, placementOf(row))) missing();
      await getCharge(tx, account, row.parentId, true);
      [row] = await tx
        .select()
        .from(utilityPayments)
        .where(eq(utilityPayments.id, id))
        .for('update');
      if (!row) missing();
      requireWrite(account, row, 'utility_payment');
      if (!row.cancelledAt) {
        const [updated] = await tx
          .update(utilityPayments)
          .set({ cancelledAt: new Date(), cancellationReason: reason })
          .where(eq(utilityPayments.id, id))
          .returning();
        if (!updated) deny();
        row = updated;
      }
      return paymentSummary(tx, row);
    });
    route('DELETE', `/api/${type}/:id`, 409, async (tx, account, request) => {
      const id = parse(Id, request.params).id;
      if (type === 'charges') await getCharge(tx, account, id, true);
      else {
        const [row] = await tx.select().from(utilityPayments).where(eq(utilityPayments.id, id));
        if (!row) missing();
        await getCharge(tx, account, row.parentId, true);
      }
      throw new Failure(409, 'CANCEL_INSTEAD_OF_DELETE');
    });
  }
}
