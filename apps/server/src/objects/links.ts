import { eq, recordLinks, sql, type Transaction } from '@homecrm/db';
import { canViewLink, canWriteLink } from '@homecrm/shared';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { referenceRows } from './references.ts';
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
function endSummary(
  type: ReturnType<typeof typeFor>,
  row: Awaited<ReturnType<typeof readReference>>['row'],
) {
  return {
    type,
    id: row.id,
    title: row.title,
    trashed: row.deletedAt !== null,
    deletedAt: row.deletedAt,
    ...('objectType' in row ? { objectType: row.objectType } : {}),
  };
}
function summary(link: Link, ends: Awaited<ReturnType<typeof endpoints>>) {
  const { id, role, authorId, createdAt, updatedAt, deletedAt } = link;
  return {
    id,
    left: endSummary(typeFor(link.leftTable), ends.left.row),
    right: endSummary(typeFor(link.rightTable), ends.right.row),
    role,
    authorId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
type LinkSummary = ReturnType<typeof summary>;
interface ListedLink extends Record<string, unknown> {
  id: string;
  left: LinkSummary['left'];
  right: LinkSummary['right'];
  role: string;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
async function listLinks(
  tx: Transaction,
  candidates: ReturnType<typeof sql>,
  where: ReturnType<typeof sql>,
  limit: number,
  offset = 0,
  byId = false,
) {
  return (
    await tx.execute<ListedLink>(sql`
    WITH candidates AS MATERIALIZED (SELECT l.* FROM record_links l WHERE ${candidates}),
      wanted AS MATERIALIZED (
        SELECT left_table AS table_name,left_id AS id FROM candidates
        UNION SELECT right_table,right_id FROM candidates
      ), refs AS MATERIALIZED (${referenceRows})
    SELECT l.id,l.role,l.author_id AS "authorId",l.created_at AS "createdAt",
      l.updated_at AS "updatedAt",l.deleted_at AS "deletedAt",
      jsonb_build_object('type',a.type,'id',a.id,'title',a.title,'trashed',a.deleted_at IS NOT NULL,
        'deletedAt',a.deleted_at,'objectType',a.object_type) AS "left",
      jsonb_build_object('type',b.type,'id',b.id,'title',b.title,'trashed',b.deleted_at IS NOT NULL,
        'deletedAt',b.deleted_at,'objectType',b.object_type) AS "right"
    FROM candidates l
      JOIN refs a ON (a.table_name,a.id)=(l.left_table,l.left_id)
      JOIN refs b ON (b.table_name,b.id)=(l.right_table,l.right_id)
    WHERE ${where}
    ORDER BY ${byId ? sql`l.id` : sql`l.created_at,l.id`} LIMIT ${limit} OFFSET ${offset}`)
  ).rows;
}
export function registerLinks(route: DataRoute) {
  route('POST', '/api/links', 201, async (tx, account, request) => {
    const body = parse(CreateLink, request.body);
    const left = await readReference(tx, account, body.left);
    const right = await readReference(tx, account, body.right);
    if (left.facts.trashed || right.facts.trashed) throw new Failure(409, 'CONFLICT');
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
    return summary(link, { left, right });
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
    return listLinks(
      tx,
      sql`((l.left_table=${name} AND l.left_id=${ref.id}) OR (l.right_table=${name} AND l.right_id=${ref.id}))
        AND ${query.trash === 'true' ? sql`l.deleted_at IS NOT NULL` : sql`l.deleted_at IS NULL`}`,
      query.trash === 'true' ? sql`true` : sql`a.deleted_at IS NULL AND b.deleted_at IS NULL`,
      query.limit,
      query.offset,
    );
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
        return summary(updated, { left, right });
      },
    );
}
export async function exportLinks(tx: Transaction, account: Account) {
  const adminSpaces = [...account.viewer.memberships]
    .filter(([, role]) => role === 'admin')
    .map(([id]) => sql`${id}::uuid`);
  const admin = adminSpaces.length
    ? sql`(a.space_id IN (${sql.join(adminSpaces, sql`,`)}) OR b.space_id IN (${sql.join(adminSpaces, sql`,`)}))`
    : sql`false`;
  const exported: ListedLink[] = [];
  let after: string | undefined;
  for (;;) {
    const page = await listLinks(
      tx,
      after ? sql`l.id > ${after}::uuid` : sql`true`,
      sql`(a.space_kind='personal' OR b.space_kind='personal' OR ${admin})`,
      100,
      0,
      true,
    );
    exported.push(...page);
    if (page.length < 100) break;
    after = page.at(-1)?.id;
  }
  return exported;
}
