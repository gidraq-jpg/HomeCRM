import {
  and,
  contacts,
  eq,
  isNull,
  recordLinks,
  sql,
  type Transaction,
  type utilityAccounts,
} from '@homecrm/db';
import { canView, type Placement, PropertyData } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import {
  Failure,
  missing,
  parse,
  placementFrom,
  placementOf,
  type Row,
} from '../objects/support.ts';

export async function defaultHousePlacement(
  tx: Transaction,
  account: Account,
  audience: 'adults' | 'household',
): Promise<Placement> {
  const spaceId = [...account.viewer.memberships.keys()].sort()[0];
  if (!spaceId) return placementFrom(tx, account);
  return placementFrom(tx, account, spaceId, audience);
}
/** Ссылки на участников не дают вводить посторонние id. Контакты-собственники — OBJ-2. */
export async function validateProperty(
  tx: Transaction,
  account: Account,
  place: Placement,
  data: unknown,
  options: { previous?: unknown; omitUnavailableOwners?: boolean } = {},
) {
  const property = parse(PropertyData, data);
  const retained = PropertyData.safeParse(options.previous ?? {});
  const ownerMemberIds: string[] = [];
  for (const id of property.ownerMemberIds ?? []) {
    if (retained.success && retained.data.ownerMemberIds?.includes(id)) {
      ownerMemberIds.push(id);
      continue;
    }
    const visible =
      (
        await tx.execute(sql`SELECT 1 FROM space_members WHERE account_id=${id}::uuid AND left_at IS NULL AND space_id IN
      (SELECT space_id FROM space_members WHERE account_id=${account.id}::uuid AND left_at IS NULL)
      ${place.kind === 'household' ? sql`AND space_id=${place.spaceId}::uuid` : sql``} LIMIT 1`)
      ).rows.length > 0;
    if (id !== account.id && !visible) {
      if (options.omitUnavailableOwners) continue;
      throw new Failure(400, 'INVALID_OWNER');
    }
    ownerMemberIds.push(id);
  }
  return property.ownerMemberIds ? { ...property, ownerMemberIds } : property;
}
export function publicRecord<T extends Row & { title: string; createdAt: Date; updatedAt: Date }>(
  row: T,
) {
  const {
    id,
    title,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  } = row;
  return {
    id,
    title,
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
export function contactSummary(row: typeof contacts.$inferSelect) {
  return { ...publicRecord(row), kind: row.kind, data: row.data };
}
export async function accountSummary(
  tx: Transaction,
  account: Account,
  row: typeof utilityAccounts.$inferSelect,
) {
  const [provider] = row.supplierId
    ? await tx.select().from(contacts).where(eq(contacts.id, row.supplierId))
    : [];
  const supplier =
    provider && canView(account.viewer, placementOf(provider))
      ? { id: provider.id, title: provider.title, deletedAt: provider.deletedAt }
      : null;
  return {
    ...publicRecord(row),
    parentId: row.parentId,
    data: row.data,
    supplierId: supplier?.id ?? null,
    supplierHidden: row.supplierId !== null && supplier === null,
    supplier,
  };
}
export async function provider(tx: Transaction, account: Account, id: string | null) {
  if (!id) return;
  const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (
    !row ||
    !canView(account.viewer, placementOf(row)) ||
    row.deletedAt !== null ||
    row.kind !== 'organization'
  )
    missing();
}
export async function peopleOf(tx: Transaction, account: Account, objectId: string) {
  const links = await tx
    .select()
    .from(recordLinks)
    .where(
      and(
        isNull(recordLinks.deletedAt),
        sql`(${recordLinks.leftTable}='objects' AND ${recordLinks.leftId}=${objectId}::uuid AND ${recordLinks.rightTable}='contacts') OR (${recordLinks.rightTable}='objects' AND ${recordLinks.rightId}=${objectId}::uuid AND ${recordLinks.leftTable}='contacts')`,
      ),
    );
  const result = [];
  for (const link of links) {
    const id = link.leftTable === 'contacts' ? link.leftId : link.rightId;
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)));
    if (row && canView(account.viewer, placementOf(row)))
      result.push({ linkId: link.id, role: link.role, contact: contactSummary(row) });
  }
  return result;
}
