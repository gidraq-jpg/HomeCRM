import { and, eq, isNull, recordLinks, sql, type Transaction } from '@homecrm/db';
import { canViewLink, canWriteLink } from '@homecrm/shared';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { Confirm, CreateLink, Id, PatchLink, Reference } from './schemas.ts';
import {
  type DataRoute,
  deny,
  Failure,
  missing,
  parse,
  readReference,
  tableForType as tableFor,
  typeForTable as typeFor,
} from './support.ts';

type Link = typeof recordLinks.$inferSelect;
async function endpoints(tx: Transaction, account: Account, link: Link) {
  const left = await readReference(tx, account, { type: typeFor(link.leftTable), id: link.leftId });
  const right = await readReference(tx, account, {
    type: typeFor(link.rightTable),
    id: link.rightId,
  });
  if (!canViewLink(account.viewer, left.facts, right.facts)) missing();
  return { left, right };
}
function summary(link: Link) {
  const { id, role, authorId, createdAt, updatedAt, deletedAt } = link;
  return {
    id,
    left: { type: typeFor(link.leftTable), id: link.leftId },
    right: { type: typeFor(link.rightTable), id: link.rightId },
    role,
    authorId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
async function visibleLinks(tx: Transaction, account: Account, rows: Link[], trash = false) {
  const result = [];
  for (const link of rows)
    try {
      const { left, right } = await endpoints(tx, account, link);
      if (trash || (left.row.deletedAt === null && right.row.deletedAt === null))
        result.push(summary(link));
    } catch (error) {
      if (!(error instanceof Failure && error.status === 404)) throw error;
    }
  return result;
}
export function registerLinks(route: DataRoute) {
  route('POST', '/api/links', 201, async (tx, account, request) => {
    const body = parse(CreateLink, request.body);
    const left = await readReference(tx, account, body.left);
    const right = await readReference(tx, account, body.right);
    if (!canWriteLink(account.viewer, left.facts, right.facts)) deny();
    const [link] = await tx
      .insert(recordLinks)
      .values({
        leftTable: tableFor(body.left.type),
        leftId: body.left.id,
        rightTable: tableFor(body.right.type),
        rightId: body.right.id,
        role: body.role,
        authorId: account.id,
      })
      .returning();
    if (!link) throw new Error('Link insert returned no row');
    return summary(link);
  });
  route('GET', '/api/records/:type/:id/links', 200, async (tx, account, request) => {
    const ref = parse(Reference, request.params);
    await readReference(tx, account, ref);
    const query = parse(
      z.strictObject({
        trash: z.enum(['true', 'false']).default('false'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(50000).default(0),
      }),
      request.query,
    );
    const name = tableFor(ref.type);
    const rows = await tx
      .select()
      .from(recordLinks)
      .where(
        and(
          sql`((${recordLinks.leftTable}=${name} AND ${recordLinks.leftId}=${ref.id}) OR (${recordLinks.rightTable}=${name} AND ${recordLinks.rightId}=${ref.id}))`,
          query.trash === 'true'
            ? sql`${recordLinks.deletedAt} IS NOT NULL`
            : isNull(recordLinks.deletedAt),
        ),
      )
      .orderBy(recordLinks.createdAt, recordLinks.id)
      .limit(query.limit)
      .offset(query.offset);
    return visibleLinks(tx, account, rows, query.trash === 'true');
  });
  for (const action of ['patch', 'trash', 'restore'] as const)
    route(
      action === 'patch' ? 'PATCH' : 'POST',
      action === 'patch' ? '/api/links/:id' : `/api/links/:id/${action}`,
      200,
      async (tx, account, request) => {
        const id = parse(Id, request.params).id;
        const [link] = await tx.select().from(recordLinks).where(eq(recordLinks.id, id));
        if (!link) missing();
        const { left, right } = await endpoints(tx, account, link);
        if (!canWriteLink(account.viewer, left.facts, right.facts)) deny();
        const body =
          action === 'patch' ? parse(PatchLink, request.body) : parse(Confirm, request.body ?? {});
        if (action === 'patch' && link.deletedAt !== null) deny();
        const [updated] = await tx
          .update(recordLinks)
          .set(
            action === 'patch'
              ? { role: (body as z.infer<typeof PatchLink>).role }
              : { deletedAt: action === 'trash' ? new Date() : null },
          )
          .where(eq(recordLinks.id, id))
          .returning();
        if (!updated) deny();
        return summary(updated);
      },
    );
}
export async function exportLinks(tx: Transaction, account: Account) {
  const rows = await tx.select().from(recordLinks);
  const exported = [];
  for (const link of rows)
    try {
      const { left, right } = await endpoints(tx, account, link);
      const eligible = [left.row, right.row].some(
        (row) =>
          row.spaceKind === 'personal' || account.viewer.memberships.get(row.spaceId) === 'admin',
      );
      if (eligible) exported.push(summary(link));
    } catch (error) {
      if (!(error instanceof Failure && error.status === 404)) throw error;
    }
  return exported;
}
