import {
  and,
  contacts,
  documents,
  eq,
  isNull,
  recordLinks,
  spaceMembers,
  spaces,
  sql,
  type Transaction,
} from '@homecrm/db';
import {
  canChangeAudience,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  canViewDocument,
  type DeadlineRule,
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  DocumentData,
  DocumentOwner,
  documentWarnings,
  IDENTITY_DOCUMENT_TYPES,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { fileSummary, filesOf } from '../files/service.ts';
import { getObject } from '../objects/routes.ts';
import {
  columnsOf,
  dataRoutes,
  deny,
  Failure,
  factsOf,
  missing,
  parse,
  placementFrom,
  placementOf,
  requireWrite,
  version,
} from '../objects/support.ts';
import { publicRecord } from '../utilities/service.ts';

const Id = z.strictObject({ id: z.uuid() });
const title = z.string().trim().min(1).max(200);
const Create = z.strictObject({
  title,
  data: DocumentData.default(() => DocumentData.parse({})),
  owner: DocumentOwner.nullable().default(null),
  placement: z
    .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
    .optional(),
  assigneeId: z.uuid().optional(),
});
async function read(tx: Transaction, account: Account, id: string, lock = false) {
  const query = tx
    .select({ document: documents, ...summaryFields })
    .from(documents)
    .where(eq(documents.id, id));
  const [row] = await (lock ? query.for('update') : query);
  if (!row || !visibleDocument(account, row.document, row.ownerIsChild)) missing();
  return row.document;
}
const summaryFields = {
  expiryRule: sql<DeadlineRule | null>`(SELECT d.rule FROM deadlines d WHERE d.document_id=documents.id AND d.deleted_at IS NULL)`,
  ownerIsChild: sql<boolean>`app.document_owner_is_child(${documents.ownerAccountId})`,
  contactId: sql<
    string | null
  >`(SELECT c.id FROM contacts c WHERE c.id=documents.owner_contact_id AND c.deleted_at IS NULL)`,
  objectTitle: sql<
    string | null
  >`(SELECT o.title FROM objects o WHERE o.id=documents.owner_object_id AND o.deleted_at IS NULL)`,
  objectId: sql<
    string | null
  >`(SELECT o.id FROM objects o WHERE o.id=documents.owner_object_id AND o.deleted_at IS NULL)`,
  memberId: sql<
    string | null
  >`(SELECT p.account_id FROM member_profiles p WHERE p.account_id=documents.owner_account_id)`,
  ownerContactTitle: sql<
    string | null
  >`(SELECT c.title FROM contacts c WHERE c.id=documents.owner_contact_id AND c.deleted_at IS NULL)`,
  previousId: sql<string | null>`(SELECT p.id FROM documents p WHERE p.id=documents.previous_id)`,
};
type SummaryFields = {
  expiryRule: DeadlineRule | null;
  ownerIsChild: boolean;
  contactId: string | null;
  objectTitle: string | null;
  objectId: string | null;
  memberId: string | null;
  ownerContactTitle: string | null;
  previousId: string | null;
};
function visibleDocument(
  account: Account,
  row: typeof documents.$inferSelect,
  ownerIsChild: boolean,
) {
  return canViewDocument(
    account.viewer,
    placementOf(row),
    IDENTITY_DOCUMENT_TYPES.includes(row.data.type),
    ownerIsChild,
  );
}
function present(row: typeof documents.$inferSelect, fields: SummaryFields) {
  return {
    ...publicRecord(row),
    data: row.data,
    expiryRule: fields.expiryRule,
    objectTitle: fields.objectTitle,
    ownerContactTitle: fields.ownerContactTitle,
    warnings: row.data.warnings ?? documentWarnings(row.data.type),
    status: row.status,
    previousId: fields.previousId,
    owner: fields.memberId
      ? { kind: 'member', id: fields.memberId }
      : fields.objectId
        ? { kind: 'object', id: fields.objectId }
        : fields.contactId
          ? { kind: 'contact', id: fields.contactId }
          : null,
  };
}
async function summary(tx: Transaction, row: typeof documents.$inferSelect) {
  const [fields] = await tx.select(summaryFields).from(documents).where(eq(documents.id, row.id));
  if (!fields) missing();
  return present(row, fields);
}
async function ownerPlace(tx: Transaction, account: Account, owner: DocumentOwner | null) {
  if (owner?.kind === 'object') return placementOf(await getObject(tx, account, owner.id));
  if (owner?.kind === 'contact') {
    const [row] = await tx.select().from(contacts).where(eq(contacts.id, owner.id));
    if (!row || row.deletedAt || !canView(account.viewer, placementOf(row))) missing();
  }
  if (owner?.kind === 'member') {
    const memberships = await tx
      .select()
      .from(spaceMembers)
      .where(eq(spaceMembers.accountId, owner.id));
    const common = memberships.filter(
      (m) => m.leftAt === null && account.viewer.memberships.has(m.spaceId),
    );
    if (owner.id !== account.id && common.length === 0) missing();
    if (common.some((m) => m.role === 'child')) {
      const house = common.find((m) => m.role === 'child');
      if (!house) missing();
      return placementFrom(tx, account, house.spaceId, 'adults');
    }
  }
  return placementFrom(tx, account);
}
const ownerColumns = (owner: DocumentOwner | null) => ({
  ownerAccountId: owner?.kind === 'member' ? owner.id : null,
  ownerContactId: owner?.kind === 'contact' ? owner.id : null,
  ownerObjectId: owner?.kind === 'object' ? owner.id : null,
});

export async function documentRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('GET', '/api/document-types', 200, async () =>
    DOCUMENT_TYPES.map((type) => ({
      type,
      label: DOCUMENT_LABELS[type],
      warnings: documentWarnings(type),
    })),
  );
  route('POST', '/api/documents', 201, async (tx, account, request) => {
    const body = parse(Create, request.body);
    const defaults = await ownerPlace(tx, account, body.owner);
    const place = body.placement
      ? await placementFrom(tx, account, body.placement.spaceId, body.placement.audience, 'adults')
      : defaults;
    if (!canCreate(account.viewer, { type: 'document', placement: place, authorId: account.id }))
      deny();
    // Удостоверения детей нельзя открыть другим детям сменой аудитории.
    if (
      body.owner?.kind === 'member' &&
      IDENTITY_DOCUMENT_TYPES.includes(body.data.type) &&
      place.kind === 'household' &&
      place.audience === 'household'
    ) {
      const { rows } = await tx.execute<{ child: boolean }>(
        sql`SELECT app.document_owner_is_child(${body.owner.id}::uuid) AS child`,
      );
      if (rows[0]?.child) deny();
    }
    const [row] = await tx
      .insert(documents)
      .values({
        ...columnsOf(place),
        ...ownerColumns(body.owner),
        authorId: account.id,
        assigneeId: body.assigneeId,
        title: body.title,
        data: body.data,
      })
      .returning();
    if (!row) deny();
    if (body.owner?.kind === 'contact')
      await tx.insert(recordLinks).values({
        leftTable: 'documents',
        leftId: row.id,
        rightTable: 'contacts',
        rightId: body.owner.id,
        role: 'document_owner',
        authorId: account.id,
      });
    return summary(tx, row);
  });
  route('GET', '/api/documents', 200, async (tx, account, request) => {
    const query = parse(
      z
        .strictObject({
          ownerKind: z.enum(['member', 'contact', 'object']).optional(),
          ownerId: z.uuid().optional(),
          type: z.enum(DOCUMENT_TYPES).optional(),
          expiry: z.enum(['expiring', 'expired']).optional(),
          scope: z.enum(['all', 'personal', 'household']).default('all'),
          spaceId: z.uuid().optional(),
          q: z.string().trim().max(200).optional(),
          trash: z.enum(['true', 'false']).default('false'),
          status: z.enum(['valid', 'invalid', 'all']).default('valid'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          offset: z.coerce.number().int().min(0).max(50000).default(0),
        })
        .refine((q) => !q.ownerKind || !!q.ownerId),
      request.query,
    );
    const today = sql`(CURRENT_TIMESTAMP AT TIME ZONE coalesce(${spaces.timeZone},h.time_zone,'UTC'))::date`;
    const typeMatches = query.q
      ? DOCUMENT_TYPES.filter(
          (t) =>
            t === query.q ||
            DOCUMENT_LABELS[t].toLowerCase().includes(query.q?.toLowerCase() ?? ''),
        )
      : [];
    const rows = await tx
      .select({ document: documents, ...summaryFields })
      .from(documents)
      .innerJoin(spaces, eq(spaces.id, documents.spaceId))
      .leftJoin(
        sql`LATERAL (SELECT hs.time_zone FROM space_members m JOIN spaces hs ON hs.id=m.space_id WHERE m.account_id=${documents.assigneeId} AND m.left_at IS NULL ORDER BY hs.id LIMIT 1) h`,
        sql`true`,
      )
      .where(
        and(
          query.trash === 'true'
            ? sql`${documents.deletedAt} IS NOT NULL`
            : isNull(documents.deletedAt),
          query.status === 'all' ? undefined : eq(documents.status, query.status),
          query.type ? sql`${documents.data}->>'type'=${query.type}` : undefined,
          query.scope === 'all' ? undefined : eq(documents.spaceKind, query.scope),
          query.spaceId ? eq(documents.spaceId, query.spaceId) : undefined,
          query.ownerId
            ? query.ownerKind === 'object'
              ? eq(documents.ownerObjectId, query.ownerId)
              : query.ownerKind === 'contact'
                ? sql`${documents.ownerContactId}=${query.ownerId}::uuid AND EXISTS(SELECT 1 FROM contacts owner WHERE owner.id=${documents.ownerContactId})`
                : eq(documents.ownerAccountId, query.ownerId)
            : undefined,
          query.expiry
            ? sql`(SELECT (d.rule->>'date')::date+coalesce((d.rule->>'durationDays')::int,0) FROM deadlines d WHERE d.document_id=documents.id AND d.deleted_at IS NULL) ${query.expiry === 'expired' ? sql`< ${today}` : sql`BETWEEN ${today} AND ${today}+90`}`
            : undefined,
          query.q
            ? sql`(${documents.title} ILIKE ${`%${query.q.replace(/[\\%_]/g, '\\$&')}%`} OR ${documents.data}->>'type'=ANY(ARRAY[${sql.join(
                typeMatches.map((t) => sql`${t}`),
                sql`, `,
              )}]::text[]))`
            : undefined,
        ),
      )
      .orderBy(documents.title, documents.id)
      .limit(query.limit)
      .offset(query.offset);
    return rows
      .filter(({ document, ownerIsChild }) => visibleDocument(account, document, ownerIsChild))
      .map(({ document, ...fields }) => present(document, fields));
  });
  route('GET', '/api/documents/:id', 200, async (tx, account, request) => {
    const row = await read(tx, account, parse(Id, request.params).id);
    return {
      ...(await summary(tx, row)),
      files: (await filesOf(tx, 'document', row.id)).filter((f) => !f.deletedAt).map(fileSummary),
    };
  });
  route('GET', '/api/documents/:id/history', 200, async (tx, account, request) => {
    const row = await read(tx, account, parse(Id, request.params).id);
    return (
      await tx.execute(
        sql`SELECT * FROM documents_history WHERE record_id=${row.id}::uuid ORDER BY created_at,id`,
      )
    ).rows;
  });
  route('PATCH', '/api/documents/:id', 200, async (tx, account, request) => {
    const body = parse(
      z
        .strictObject({
          title: title.optional(),
          data: DocumentData.optional(),
          owner: DocumentOwner.nullable().optional(),
          expectedUpdatedAt: z.iso.datetime().optional(),
        })
        .refine((b) => b.title !== undefined || b.data !== undefined),
      request.body,
    );
    const row = await read(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, row, 'document');
    if (row.status !== 'valid') throw new Failure(409, 'DOCUMENT_INVALID');
    version(body.expectedUpdatedAt, row.updatedAt);
    if (body.owner !== undefined) {
      const current = (await summary(tx, row)).owner;
      if (
        (body.owner === null && current !== null) ||
        (body.owner !== null &&
          (body.owner.kind !== current?.kind || body.owner.id !== current?.id))
      )
        throw new Failure(400, 'OWNER_IMMUTABLE');
    }
    const { expectedUpdatedAt: _version, owner: _owner, ...changes } = body;
    const [updated] = await tx
      .update(documents)
      .set(changes)
      .where(eq(documents.id, row.id))
      .returning();
    if (!updated) deny();
    return summary(tx, updated);
  });
  route('POST', '/api/documents/:id/renew', 201, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        title: title.optional(),
        data: DocumentData,
        expectedUpdatedAt: z.iso.datetime().optional(),
      }),
      request.body,
    );
    const row = await read(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, row, 'document');
    version(body.expectedUpdatedAt, row.updatedAt);
    if (row.status !== 'valid') throw new Failure(409, 'DOCUMENT_INVALID');
    await tx.update(documents).set({ status: 'invalid' }).where(eq(documents.id, row.id));
    const [created] = await tx
      .insert(documents)
      .values({
        ...columnsOf(placementOf(row)),
        authorId: account.id,
        assigneeId: row.assigneeId,
        title: body.title ?? row.title,
        data: body.data,
        ownerAccountId: row.ownerAccountId,
        ownerContactId: row.ownerContactId,
        ownerObjectId: row.ownerObjectId,
        previousId: row.id,
      })
      .returning();
    if (!created) deny();
    const links = await tx
      .select()
      .from(recordLinks)
      .where(
        sql`deleted_at IS NULL AND ((left_table='documents' AND left_id=${row.id}::uuid) OR (right_table='documents' AND right_id=${row.id}::uuid))`,
      );
    for (const link of links)
      await tx.insert(recordLinks).values({
        leftTable: link.leftTable,
        leftId: link.leftTable === 'documents' && link.leftId === row.id ? created.id : link.leftId,
        rightTable: link.rightTable,
        rightId:
          link.rightTable === 'documents' && link.rightId === row.id ? created.id : link.rightId,
        role: link.role,
        authorId: account.id,
      });
    return summary(tx, created);
  });
  route('GET', '/api/documents/:id/versions', 200, async (tx, account, request) => {
    const { id } = parse(Id, request.params);
    const rows = await tx
      .select({ document: documents, ...summaryFields })
      .from(documents)
      .where(sql`${documents.id} IN (
        WITH RECURSIVE ancestors AS (
          SELECT id,previous_id FROM documents WHERE id=${id}::uuid
          UNION ALL SELECT d.id,d.previous_id FROM documents d JOIN ancestors a ON d.id=a.previous_id
        ), versions AS (
          SELECT id FROM ancestors WHERE previous_id IS NULL OR NOT EXISTS(SELECT 1 FROM documents p WHERE p.id=ancestors.previous_id)
          UNION ALL SELECT d.id FROM documents d JOIN versions v ON d.previous_id=v.id
        ) SELECT id FROM versions
      )`)
      .orderBy(documents.createdAt, documents.id);
    const visible = rows
      .filter(({ document, ownerIsChild }) => visibleDocument(account, document, ownerIsChild))
      .map(({ document, ...fields }) => present(document, fields));
    if (!visible.some((document) => document.id === id)) missing();
    return visible;
  });
  for (const action of ['trash', 'restore'] as const) {
    const handler = async (
      tx: Transaction,
      account: Account,
      request: { params: unknown; body?: unknown },
    ) => {
      parse(z.strictObject({}), request.body ?? {});
      const row = await read(tx, account, parse(Id, request.params).id, true);
      if (!(action === 'trash' ? canTrash : canRestore)(account.viewer, factsOf(row, 'document')))
        deny();
      const [updated] = await tx
        .update(documents)
        .set({ deletedAt: action === 'trash' ? new Date() : null })
        .where(eq(documents.id, row.id))
        .returning();
      if (!updated) deny();
      return summary(tx, updated);
    };
    route('POST', `/api/documents/:id/${action}`, 200, handler);
    if (action === 'trash') route('DELETE', '/api/documents/:id', 200, handler);
  }
  route('POST', '/api/documents/:id/move', 200, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        spaceId: z.uuid(),
        audience: z.enum(['household', 'adults']).optional(),
        confirmed: z.literal(true),
        assigneeId: z.uuid().optional(),
      }),
      request.body,
    );
    const row = await read(tx, account, parse(Id, request.params).id, true);
    const target = await placementFrom(tx, account, body.spaceId, body.audience, 'adults');
    const facts = factsOf(row, 'document');
    if (
      !(row.spaceId === target.spaceId
        ? canChangeAudience(account.viewer, facts, target)
        : canMove(account.viewer, facts, target, row.hasOtherContributions))
    )
      deny();
    const [updated] = await tx
      .update(documents)
      .set({
        ...columnsOf(target),
        assigneeId: body.assigneeId ?? (target.kind === 'personal' ? account.id : row.assigneeId),
      })
      .where(eq(documents.id, row.id))
      .returning();
    if (!updated) deny();
    return summary(tx, updated);
  });
  route('POST', '/api/documents/:id/assignee', 200, async (tx, account, request) => {
    const { assigneeId } = parse(z.strictObject({ assigneeId: z.uuid() }), request.body);
    const row = await read(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, row, 'document');
    const allowed = (
      await tx.execute<{ visible: boolean }>(
        sql`SELECT app.record_notification_visible('documents',${row.id}::uuid,${assigneeId}::uuid) AS visible`,
      )
    ).rows[0]?.visible;
    if (!allowed) throw new Failure(409, 'ASSIGNEE_NOT_VISIBLE');
    const [updated] = await tx
      .update(documents)
      .set({ assigneeId })
      .where(eq(documents.id, row.id))
      .returning();
    if (!updated) deny();
    return summary(tx, updated);
  });
}
