import { contacts, eq, sql, type Transaction } from '@homecrm/db';
import { canView, contactActions, OrganizationData, PersonData } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { deny, missing, placementOf, requireWrite } from '../records/support.ts';
import { publicRecord } from '../utilities/service.ts';

export const organization = sql<{
  id: string;
  title: string;
} | null>`(SELECT jsonb_build_object('id',o.id,'title',o.title) FROM contacts o WHERE o.id=contacts.organization_id AND o.kind='organization' AND o.deleted_at IS NULL)`;
export function present(
  row: typeof contacts.$inferSelect,
  org: { id: string; title: string } | null,
) {
  const person = row.kind === 'person' ? PersonData.parse(row.data) : null;
  const data = person
    ? { ...person, birthdayEnabled: person.birthdayEnabled ?? false }
    : OrganizationData.parse(row.data);
  return {
    ...publicRecord(row),
    kind: row.kind,
    data,
    organizationId: org?.id ?? null,
    organization: org,
    actions: contactActions(data),
  };
}
export async function getContact(tx: Transaction, account: Account, id: string, lock = false) {
  const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  if (lock) {
    if (!row.deletedAt) requireWrite(account, row, 'contact');
    const [locked] = await tx.select().from(contacts).where(eq(contacts.id, id)).for('update');
    if (!locked) deny();
    return locked;
  }
  return row;
}
