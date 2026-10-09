import { and, contactInteractions, contacts, eq, isNull, sql, type Transaction } from '@homecrm/db';
import {
  canChangeAudience,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  canViewInteraction,
  contactActions,
  InteractionData,
  ORGANIZATION_TYPES,
  OrganizationData,
  PERSON_CATEGORIES,
  PersonData,
} from '@homecrm/shared';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { getObject } from '../objects/routes.ts';
import {
  columnsOf,
  type DataRoute,
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
import { defaultHousePlacement, publicRecord } from '../utilities/service.ts';

const Id = z.strictObject({ id: z.uuid() });
const title = z.string().trim().min(1).max(200);
const List = z.strictObject({
  trash: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(50000).default(0),
});
const Create = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('organization'),
    data: OrganizationData.default(() => OrganizationData.parse({})),
  }),
  z.strictObject({
    kind: z.literal('person'),
    data: PersonData.default(() => PersonData.parse({})),
  }),
]);
const organization = sql<{
  id: string;
  title: string;
} | null>`(SELECT jsonb_build_object('id',o.id,'title',o.title) FROM contacts o WHERE o.id=contacts.organization_id AND o.kind='organization' AND o.deleted_at IS NULL)`;
function present(row: typeof contacts.$inferSelect, org: { id: string; title: string } | null) {
  const data =
    row.kind === 'person' ? PersonData.parse(row.data) : OrganizationData.parse(row.data);
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
async function summary(tx: Transaction, id: string) {
  const [result] = await tx
    .select({ row: contacts, organization })
    .from(contacts)
    .where(eq(contacts.id, id));
  if (!result) missing();
  return present(result.row, result.organization);
}
async function validateOrganization(
  tx: Transaction,
  account: Account,
  kind: string,
  id: string | null,
) {
  if (!id) return;
  if (kind !== 'person') throw new Failure(400, 'INVALID_INPUT');
  const row = await getContact(tx, account, id);
  if (row.kind !== 'organization' || row.deletedAt) missing();
}
export async function contactRoutes(route: DataRoute) {
  route('POST', '/api/contacts', 201, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        title,
        kind: z.enum(['person', 'organization']).default('organization'),
        data: z.unknown().optional(),
        organizationId: z.uuid().nullable().default(null),
        placement: z
          .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
          .optional(),
      }),
      request.body,
    );
    const parsed = parse(Create, { kind: body.kind, data: body.data });
    const place = body.placement
      ? await placementFrom(tx, account, body.placement.spaceId, body.placement.audience)
      : parsed.kind === 'person' && !parsed.data.categories.includes('craftsperson')
        ? await placementFrom(tx, account)
        : await defaultHousePlacement(tx, account, 'household');
    if (!canCreate(account.viewer, { type: 'contact', placement: place, authorId: account.id }))
      deny();
    await validateOrganization(tx, account, body.kind, body.organizationId);
    const [row] = await tx
      .insert(contacts)
      .values({
        ...columnsOf(place),
        title: body.title,
        kind: body.kind,
        data: parsed.data,
        organizationId: body.organizationId,
        authorId: account.id,
      })
      .returning();
    if (!row) deny();
    return summary(tx, row.id);
  });
  route('GET', '/api/contacts', 200, async (tx, account, request) => {
    const q = parse(
      List.extend({
        kind: z.enum(['person', 'organization']).optional(),
        category: z.enum(PERSON_CATEGORIES).optional(),
        organizationType: z.enum(ORGANIZATION_TYPES).optional(),
        scope: z.enum(['all', 'personal', 'household']).default('all'),
        q: z.string().trim().max(200).optional(),
      }),
      request.query,
    );
    const rows = await tx
      .select({ row: contacts, organization })
      .from(contacts)
      .where(
        and(
          q.trash === 'true' ? sql`${contacts.deletedAt} IS NOT NULL` : isNull(contacts.deletedAt),
          q.scope === 'all' ? undefined : eq(contacts.spaceKind, q.scope),
          q.kind ? eq(contacts.kind, q.kind) : undefined,
          q.category ? sql`${contacts.data}->'categories' ? ${q.category}` : undefined,
          q.organizationType
            ? sql`${contacts.data}->>'organizationType'=${q.organizationType}`
            : undefined,
          q.q ? sql`${contacts.title} ILIKE ${`%${q.q.replace(/[\\%_]/g, '\\$&')}%`}` : undefined,
        ),
      )
      .orderBy(contacts.title, contacts.id)
      .limit(q.limit)
      .offset(q.offset);
    return rows
      .filter(({ row }) => canView(account.viewer, placementOf(row)))
      .map(({ row, organization }) => present(row, organization));
  });
  route('GET', '/api/contacts/:id', 200, async (tx, account, request) =>
    summary(tx, (await getContact(tx, account, parse(Id, request.params).id)).id),
  );
  route('PATCH', '/api/contacts/:id', 200, async (tx, account, request) => {
    const body = parse(
      z
        .strictObject({
          title: title.optional(),
          data: z.unknown().optional(),
          organizationId: z.uuid().nullable().optional(),
          expectedUpdatedAt: z.iso.datetime().optional(),
        })
        .refine(
          (b) => b.title !== undefined || b.data !== undefined || b.organizationId !== undefined,
        ),
      request.body,
    );
    const row = await getContact(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, row, 'contact');
    version(body.expectedUpdatedAt, row.updatedAt);
    const data =
      body.data === undefined ? undefined : parse(Create, { kind: row.kind, data: body.data }).data;
    let organizationId = body.organizationId;
    if (organizationId === null && row.organizationId) {
      const [visible] = await tx
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, row.organizationId), isNull(contacts.deletedAt)));
      if (!visible) organizationId = undefined;
    }
    if (organizationId !== undefined)
      await validateOrganization(tx, account, row.kind, organizationId);
    if (body.title !== undefined || data !== undefined || organizationId !== undefined)
      await tx
        .update(contacts)
        .set({ title: body.title, data, organizationId })
        .where(eq(contacts.id, row.id));
    return summary(tx, row.id);
  });
  route('GET', '/api/contacts/:id/history', 200, async (tx, account, request) => {
    const row = await getContact(tx, account, parse(Id, request.params).id);
    return (
      await tx.execute(
        sql`SELECT * FROM contacts_history WHERE record_id=${row.id}::uuid ORDER BY created_at,id`,
      )
    ).rows;
  });
  route('POST', '/api/contacts/:id/move', 200, async (tx, account, request) => {
    const body = parse(
      z.strictObject({
        spaceId: z.uuid(),
        audience: z.enum(['household', 'adults']).optional(),
        confirmed: z.literal(true),
      }),
      request.body,
    );
    const row = await getContact(tx, account, parse(Id, request.params).id, true);
    const target = await placementFrom(tx, account, body.spaceId, body.audience);
    if (
      !(row.spaceId === target.spaceId
        ? canChangeAudience(account.viewer, factsOf(row, 'contact'), target)
        : canMove(account.viewer, factsOf(row, 'contact'), target, row.hasOtherContributions))
    )
      deny();
    await tx.update(contacts).set(columnsOf(target)).where(eq(contacts.id, row.id));
    return summary(tx, row.id);
  });
  for (const action of ['trash', 'restore'] as const) {
    const handler = async (
      tx: Transaction,
      account: Account,
      request: { params: unknown; body?: unknown },
    ) => {
      parse(z.strictObject({}), request.body ?? {});
      const row = await getContact(tx, account, parse(Id, request.params).id, true);
      if (!(action === 'trash' ? canTrash : canRestore)(account.viewer, factsOf(row, 'contact')))
        deny();
      await tx
        .update(contacts)
        .set({ deletedAt: action === 'trash' ? new Date() : null })
        .where(eq(contacts.id, row.id));
      return summary(tx, row.id);
    };
    route('POST', `/api/contacts/:id/${action}`, 200, handler);
    if (action === 'trash') route('DELETE', '/api/contacts/:id', 200, handler);
  }
  const interactionFields = {
    object: sql<{
      id: string;
      title: string;
    } | null>`(SELECT jsonb_build_object('id',o.id,'title',o.title) FROM objects o WHERE o.id=contact_interactions.object_id AND o.deleted_at IS NULL)`,
  };
  const interactionSummary = (
    row: typeof contactInteractions.$inferSelect,
    obj: { id: string; title: string } | null,
  ) => ({
    ...publicRecord(row),
    parentId: row.parentId,
    kind: row.kind,
    occurredOn: row.occurredOn,
    text: row.title,
    amountCents: row.amountCents,
    callAgain: row.callAgain,
    objectId: obj?.id ?? null,
    object: obj,
  });
  route('GET', '/api/contacts/:id/interactions', 200, async (tx, account, request) => {
    const parent = await getContact(tx, account, parse(Id, request.params).id);
    const q = parse(List, request.query);
    const rows = await tx
      .select({ row: contactInteractions, ...interactionFields })
      .from(contactInteractions)
      .where(
        and(
          eq(contactInteractions.parentId, parent.id),
          q.trash === 'true'
            ? sql`${contactInteractions.deletedAt} IS NOT NULL`
            : isNull(contactInteractions.deletedAt),
        ),
      )
      .orderBy(sql`${contactInteractions.occurredOn} DESC`, contactInteractions.id)
      .limit(q.limit)
      .offset(q.offset);
    return rows
      .filter(({ row }) =>
        canViewInteraction(
          account.viewer,
          factsOf(row, 'contact_interaction'),
          factsOf(parent, 'contact'),
        ),
      )
      .map(({ row, object }) => interactionSummary(row, object));
  });
  route('POST', '/api/contacts/:id/interactions', 201, async (tx, account, request) => {
    const body = parse(InteractionData, request.body);
    const parent = await getContact(tx, account, parse(Id, request.params).id, true);
    requireWrite(account, parent, 'contact');
    if (body.objectId) {
      const object = await getObject(tx, account, body.objectId);
      if (object.deletedAt) missing();
    }
    const [row] = await tx
      .insert(contactInteractions)
      .values({
        ...columnsOf(placementOf(parent)),
        parentId: parent.id,
        authorId: account.id,
        title: body.text,
        kind: body.kind,
        occurredOn: body.occurredOn,
        amountCents: body.amountCents,
        callAgain: body.callAgain,
        objectId: body.objectId,
      })
      .returning();
    if (!row) deny();
    const [result] = await tx
      .select(interactionFields)
      .from(contactInteractions)
      .where(eq(contactInteractions.id, row.id));
    return interactionSummary(row, result?.object ?? null);
  });
  for (const action of ['patch', 'trash', 'restore', 'history'] as const)
    route(
      action === 'patch' ? 'PATCH' : action === 'history' ? 'GET' : 'POST',
      action === 'patch'
        ? '/api/contacts/:id/interactions/:interactionId'
        : `/api/contacts/:id/interactions/:interactionId/${action}`,
      200,
      async (tx, account, request) => {
        const ids = parse(Id.extend({ interactionId: z.uuid() }), request.params);
        const parent = await getContact(tx, account, ids.id, action !== 'history');
        const interactionQuery = tx
          .select()
          .from(contactInteractions)
          .where(
            and(
              eq(contactInteractions.id, ids.interactionId),
              eq(contactInteractions.parentId, parent.id),
            ),
          );
        const [row] = await (action === 'history'
          ? interactionQuery
          : interactionQuery.for('update'));
        if (
          !row ||
          !canViewInteraction(
            account.viewer,
            factsOf(row, 'contact_interaction'),
            factsOf(parent, 'contact'),
          )
        )
          missing();
        if (action === 'history')
          return (
            await tx.execute(
              sql`SELECT * FROM contact_interactions_history WHERE record_id=${row.id}::uuid ORDER BY created_at,id`,
            )
          ).rows;
        requireWrite(account, parent, 'contact');
        if (action === 'patch') {
          requireWrite(account, row, 'contact_interaction');
          const body = parse(
            InteractionData.extend({
              objectId: z.uuid().nullable().optional(),
              expectedUpdatedAt: z.iso.datetime().optional(),
            }),
            request.body,
          );
          version(body.expectedUpdatedAt, row.updatedAt);
          let objectId = body.objectId;
          if (objectId === null && row.objectId) {
            const [visible] = await tx
              .execute<{ id: string }>(
                sql`SELECT id FROM objects WHERE id=${row.objectId}::uuid AND deleted_at IS NULL`,
              )
              .then((result) => result.rows);
            if (!visible) objectId = undefined;
          }
          if (body.objectId) {
            const object = await getObject(tx, account, body.objectId);
            if (object.deletedAt) missing();
          }
          await tx
            .update(contactInteractions)
            .set({
              title: body.text,
              kind: body.kind,
              occurredOn: body.occurredOn,
              amountCents: body.amountCents,
              callAgain: body.callAgain,
              objectId,
            })
            .where(eq(contactInteractions.id, row.id));
        } else {
          parse(z.strictObject({}), request.body ?? {});
          if (
            !(action === 'trash' ? canTrash : canRestore)(
              account.viewer,
              factsOf(row, 'contact_interaction'),
            )
          )
            deny();
          await tx
            .update(contactInteractions)
            .set({ deletedAt: action === 'trash' ? new Date() : null })
            .where(eq(contactInteractions.id, row.id));
        }
        const [result] = await tx
          .select({ row: contactInteractions, ...interactionFields })
          .from(contactInteractions)
          .where(eq(contactInteractions.id, row.id));
        if (!result) deny();
        return interactionSummary(result.row, result.object);
      },
    );
}
