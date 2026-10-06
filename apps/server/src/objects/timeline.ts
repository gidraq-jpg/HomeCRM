import { and, eq, objectEvents, objects, sql, type Transaction } from '@homecrm/db';
import {
  canRestore,
  canTrash,
  canView,
  canViewTimelineEvent,
  type Placement,
} from '@homecrm/shared';
import type { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { getObject, type ObjectRow } from './routes.ts';
import {
  Confirm,
  CreateEvent,
  EventId,
  Id,
  ListTimeline,
  PatchEvent,
  TimelineCursor,
} from './schemas.ts';
import {
  columnsOf,
  type DataRoute,
  deny,
  factsOf,
  missing,
  parse,
  placementOf,
  readReference,
  requireWrite,
  snapshotPlacement,
  tableForType as tableFor,
  typeForTable as typeFor,
  version,
} from './support.ts';

type Event = typeof objectEvents.$inferSelect;
function summary(event: Event) {
  const {
    id,
    parentId,
    occurredOn,
    title,
    amountKopecks,
    rating,
    authorId,
    createdAt,
    updatedAt,
    deletedAt,
  } = event;
  return {
    id,
    parentId,
    occurredOn,
    text: title,
    amountKopecks,
    rating,
    contact:
      event.contactId && event.contactTable
        ? { type: typeFor(event.contactTable), id: event.contactId }
        : null,
    authorId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
async function visible(tx: Transaction, account: Account, event: Event) {
  if (
    !canViewTimelineEvent(
      account.viewer,
      factsOf(event, 'object_event'),
      await snapshotPlacement(tx, event.originSpaceId, event.originSpaceKind, event.originAudience),
    )
  )
    return false;
  if (event.contactId && event.contactTable) {
    try {
      await readReference(tx, account, { type: typeFor(event.contactTable), id: event.contactId });
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') return false;
      throw error;
    }
  }
  return true;
}
async function eventValues(tx: Transaction, account: Account, body: z.infer<typeof PatchEvent>) {
  if (body.contact) await readReference(tx, account, body.contact);
  return {
    occurredOn: body.occurredOn,
    title: body.text,
    amountKopecks: body.amountKopecks,
    rating: body.rating,
    ...(body.contact !== undefined
      ? {
          contactId: body.contact?.id ?? null,
          contactTable: body.contact ? tableFor(body.contact.type) : null,
        }
      : {}),
  };
}
interface FeedRow extends Record<string, unknown> {
  id: string;
  at: string;
  source: 'object' | 'field' | 'manual';
  payload: Record<string, unknown>;
  space_id: string;
  space_kind: 'personal' | 'household';
  audience: 'household' | 'adults' | null;
  owner_id: string | null;
  contact_id: string | null;
  contact_facts: {
    spaceId: string;
    spaceKind: 'personal' | 'household';
    audience: 'household' | 'adults' | null;
    ownerId: string | null;
  } | null;
}
async function feed(
  tx: Transaction,
  account: Account,
  record: ObjectRow,
  limit: number | null,
  cursor: z.infer<typeof TimelineCursor> | null,
  includeDeleted = false,
) {
  // UNION ALL и ключ времени выбираются до LIMIT; RLS действует на каждом источнике.
  const result = await tx.execute<FeedRow>(sql`
    WITH feed AS (
      SELECT h.id,h.created_at AS at,'object'::text AS source,
        jsonb_build_object('operation',h.operation,'actorId',h.actor_id,'changes',h.changes) AS payload,
        h.space_id,h.space_kind,h.audience,s.owner_account_id AS owner_id,NULL::uuid AS contact_id,NULL::jsonb AS contact_facts
      FROM objects_history h LEFT JOIN spaces s ON s.id=h.space_id WHERE h.record_id=${record.id}
        AND (h.operation='create' OR (h.operation='update' AND h.changes ?| ARRAY['title','object_type','type_data','assignee_id']))
      UNION ALL
      SELECT h.id,h.created_at,'field',jsonb_build_object('operation',h.operation,'actorId',h.actor_id,'fieldId',h.record_id,'changes',h.changes),
        h.space_id,h.space_kind,h.audience,s.owner_account_id,NULL::uuid,NULL::jsonb
      FROM object_fields_history h JOIN object_fields f ON f.id=h.record_id LEFT JOIN spaces s ON s.id=h.space_id
      WHERE f.parent_id=${record.id} AND (h.operation='create' OR (h.operation='update' AND h.changes ?| ARRAY['title','value','position']))
      UNION ALL
      SELECT e.id,e.occurred_on::timestamp AT TIME ZONE 'UTC','manual',
        jsonb_build_object('parentId',e.parent_id,'occurredOn',e.occurred_on,'text',e.title,'amountKopecks',e.amount_kopecks,'rating',e.rating,
          'contact',CASE WHEN e.contact_id IS NULL THEN NULL ELSE jsonb_build_object('type',e.contact_table,'id',e.contact_id) END,
          'authorId',e.author_id,'createdAt',e.created_at,'updatedAt',e.updated_at,'deletedAt',e.deleted_at),
        e.origin_space_id,e.origin_space_kind,e.origin_audience,s.owner_account_id,e.contact_id,
        CASE WHEN e.contact_id IS NOT NULL THEN app.record_ref_facts(e.contact_table,e.contact_id) END
      FROM object_events e LEFT JOIN spaces s ON s.id=e.origin_space_id WHERE e.parent_id=${record.id} AND (${includeDeleted} OR e.deleted_at IS NULL)
    ) SELECT id,to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,source,payload,
      space_id,space_kind,audience,owner_id,contact_id,contact_facts FROM feed
      WHERE (${cursor === null} OR (at,source,id)<(${cursor?.at ?? null}::timestamptz,${cursor?.source ?? null}::text,${cursor?.id ?? null}::uuid))
      ORDER BY at DESC,source DESC,id DESC LIMIT ${limit === null ? null : limit + 1}`);
  return result.rows
    .filter((row) => {
      const original: Placement =
        row.space_kind === 'personal'
          ? { kind: 'personal', spaceId: row.space_id, ownerId: row.owner_id ?? '' }
          : { kind: 'household', spaceId: row.space_id, audience: row.audience ?? 'household' };
      if (!canViewTimelineEvent(account.viewer, factsOf(record), original)) return false;
      if (row.contact_id) {
        const contact = row.contact_facts;
        if (!contact) return false;
        const place: Placement =
          contact.spaceKind === 'personal'
            ? { kind: 'personal', spaceId: contact.spaceId, ownerId: contact.ownerId ?? '' }
            : {
                kind: 'household',
                spaceId: contact.spaceId,
                audience: contact.audience ?? 'household',
              };
        if (!canView(account.viewer, place)) return false;
      }
      return true;
    })
    .map((row) => ({
      id: row.id,
      at: row.at,
      source: row.source,
      ...row.payload,
      ...(row.source === 'manual' && row.payload.contact
        ? {
            contact: {
              ...(row.payload.contact as { id: string }),
              type: typeFor((row.payload.contact as { type: string }).type),
            },
          }
        : {}),
    }));
}
export function registerTimeline(route: DataRoute) {
  route('GET', '/api/objects/:id/timeline', 200, async (tx, account, request) => {
    const record = await getObject(tx, account, parse(Id, request.params).id);
    const query = parse(ListTimeline, request.query);
    let cursor: z.infer<typeof TimelineCursor> | null = null;
    if (query.cursor) {
      try {
        cursor = parse(
          TimelineCursor,
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        parse(TimelineCursor, null);
      }
    }
    const rows = await feed(tx, account, record, query.limit, cursor);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? Buffer.from(JSON.stringify({ at: last.at, source: last.source, id: last.id })).toString(
              'base64url',
            )
          : null,
    };
  });
  route('POST', '/api/objects/:id/events', 201, async (tx, account, request) => {
    const record = await getObject(tx, account, parse(Id, request.params).id);
    requireWrite(account, record);
    const parent = await getObject(tx, account, record.id, true);
    requireWrite(account, parent);
    const body = parse(CreateEvent, request.body);
    const [event] = await tx
      .insert(objectEvents)
      .values({
        ...columnsOf(placementOf(parent)),
        parentId: parent.id,
        authorId: account.id,
        ...(await eventValues(tx, account, body)),
        title: body.text,
        occurredOn: body.occurredOn,
        originSpaceId: parent.spaceId,
        originSpaceKind: parent.spaceKind,
        originAudience: parent.audience,
      })
      .returning();
    if (!event) throw new Error('Event insert returned no row');
    await tx.update(objects).set({ title: parent.title }).where(eq(objects.id, parent.id));
    return summary(event);
  });
  for (const action of ['patch', 'trash', 'restore'] as const)
    route(
      action === 'patch' ? 'PATCH' : 'POST',
      action === 'patch'
        ? '/api/objects/:id/events/:eventId'
        : `/api/objects/:id/events/:eventId/${action}`,
      200,
      async (tx, account, request) => {
        const { id, eventId } = parse(EventId, request.params);
        let parent = await getObject(tx, account, id);
        requireWrite(account, parent);
        parent = await getObject(tx, account, id, true);
        requireWrite(account, parent);
        const [event] = await tx
          .select()
          .from(objectEvents)
          .where(and(eq(objectEvents.id, eventId), eq(objectEvents.parentId, id)))
          .for('update');
        if (!event || !(await visible(tx, account, event))) missing();
        let values: Partial<typeof objectEvents.$inferInsert>;
        if (action === 'patch') {
          requireWrite(account, event, 'object_event');
          const body = parse(PatchEvent, request.body);
          version(body.expectedUpdatedAt, event.updatedAt);
          values = await eventValues(tx, account, body);
        } else {
          parse(Confirm, request.body ?? {});
          if (
            action === 'trash'
              ? !canTrash(account.viewer, factsOf(event, 'object_event'))
              : !canRestore(account.viewer, factsOf(event, 'object_event'))
          )
            deny();
          values = { deletedAt: action === 'trash' ? new Date() : null };
        }
        const [updated] = await tx
          .update(objectEvents)
          .set(values)
          .where(eq(objectEvents.id, eventId))
          .returning();
        if (!updated) deny();
        await tx.update(objects).set({ title: parent.title }).where(eq(objects.id, id));
        return summary(updated);
      },
    );
}
export async function copyEvents(
  tx: Transaction,
  account: Account,
  record: ObjectRow,
  copy: ObjectRow,
) {
  const rows = await tx
    .select()
    .from(objectEvents)
    .where(and(eq(objectEvents.parentId, record.id), sql`${objectEvents.deletedAt} IS NULL`));
  for (const event of rows)
    if (await visible(tx, account, event))
      await tx.insert(objectEvents).values({
        ...columnsOf(placementOf(copy)),
        parentId: copy.id,
        authorId: account.id,
        title: event.title,
        occurredOn: event.occurredOn,
        amountKopecks: event.amountKopecks,
        rating: event.rating,
        contactTable: event.contactTable,
        contactId: event.contactId,
        originSpaceId: copy.spaceId,
        originSpaceKind: copy.spaceKind,
      });
}
export async function exportEvents(tx: Transaction, account: Account, record: ObjectRow) {
  return feed(tx, account, record, null, null, true);
}
