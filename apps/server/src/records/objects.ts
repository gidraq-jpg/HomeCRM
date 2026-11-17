import { eq, objects, type Transaction } from '@homecrm/db';
import { canView } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { deny, missing, placementOf } from './support.ts';

export type ObjectRow = typeof objects.$inferSelect;
export function summary(record: ObjectRow) {
  const {
    id,
    title,
    objectType,
    typeData,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  } = record;
  return {
    id,
    title,
    objectType,
    typeData,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
export async function getObject(
  tx: Transaction,
  account: Account,
  id: string,
  lock = false,
): Promise<ObjectRow> {
  const query = tx.select().from(objects).where(eq(objects.id, id));
  const [visible] = await query;
  if (!visible || !canView(account.viewer, placementOf(visible))) missing();
  const [record] = lock ? await query.for('update') : [visible];
  if (!record) deny();
  if (!canView(account.viewer, placementOf(record))) missing();
  return record;
}
