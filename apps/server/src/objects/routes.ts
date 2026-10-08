import {
  and,
  desc,
  eq,
  isNull,
  memberProfiles,
  objectEvents,
  objectFields,
  objectFiles,
  objects,
  spaceMembers,
  sql,
  type Transaction,
  utilityAccounts,
} from '@homecrm/db';
import {
  canBeAssignee,
  canChangeAudience,
  canCopyToPersonal,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  canViewMembership,
  type Placement,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { copyFiles, fileSummary, filesOf } from '../files/service.ts';
import {
  accountSummary,
  defaultHousePlacement,
  peopleOf,
  validateProperty,
} from '../utilities/service.ts';
import { exportLinks, registerLinks } from './links.ts';
import {
  AudienceChange,
  Confirm,
  CreateObject,
  type Fields,
  Id,
  ListObjects,
  PatchObject,
  Preview,
  Share,
} from './schemas.ts';
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
} from './support.ts';
import { copyEvents, exportEvents, registerTimeline } from './timeline.ts';

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
async function fieldsOf(tx: Transaction, account: Account, id: string) {
  return (
    await tx
      .select()
      .from(objectFields)
      .where(eq(objectFields.parentId, id))
      .orderBy(objectFields.position, objectFields.id)
  ).filter((field) => canView(account.viewer, placementOf(field)));
}
async function card(tx: Transaction, account: Account, record: ObjectRow, includeDeleted = false) {
  return {
    ...summary(record),
    peopleAndOrganizations: record.deletedAt === null ? await peopleOf(tx, account, record.id) : [],
    files: (await filesOf(tx, 'object', record.id))
      .filter((file) => includeDeleted || record.deletedAt !== null || file.deletedAt === null)
      .map(fileSummary),
    fields: (await fieldsOf(tx, account, record.id))
      .filter((field) => includeDeleted || record.deletedAt !== null || field.deletedAt === null)
      .map(({ id, title, value, position, deletedAt }) => ({
        id,
        name: title,
        value,
        position,
        deletedAt,
      })),
  };
}
async function replaceFields(
  tx: Transaction,
  account: Account,
  record: ObjectRow,
  incoming: z.infer<typeof Fields>,
) {
  const old = await fieldsOf(tx, account, record.id);
  // Сначала корзина пропущенных: замена 50 полей на другие 50 не превышает ограничение в середине транзакции.
  for (const field of old)
    if (field.deletedAt === null && !incoming.some((next) => next.id === field.id)) {
      if (!canTrash(account.viewer, factsOf(field, 'object_field'))) deny();
      await tx
        .update(objectFields)
        .set({ deletedAt: new Date() })
        .where(eq(objectFields.id, field.id));
    }
  for (const [position, field] of incoming.entries()) {
    if (field.id) {
      const existing = old.find((value) => value.id === field.id);
      if (!existing) throw new Failure(400, 'INVALID_FIELD');
      if (existing.deletedAt !== null) {
        if (!canRestore(account.viewer, factsOf(existing, 'object_field'))) deny();
        await tx.update(objectFields).set({ deletedAt: null }).where(eq(objectFields.id, field.id));
      } else requireWrite(account, existing, 'object_field');
      await tx
        .update(objectFields)
        .set({ title: field.name, value: field.value, position })
        .where(eq(objectFields.id, field.id));
    } else
      await tx.insert(objectFields).values({
        ...columnsOf(placementOf(record)),
        parentId: record.id,
        authorId: account.id,
        title: field.name,
        value: field.value,
        position,
      });
  }
}
async function responsible(
  tx: Transaction,
  account: Account,
  place: Placement,
  id: string | null | undefined,
) {
  if (!id || place.kind === 'personal') return;
  const [member] = await tx
    .select()
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.spaceId, place.spaceId),
        eq(spaceMembers.accountId, id),
        isNull(spaceMembers.leftAt),
      ),
    );
  if (
    !member ||
    !canBeAssignee({ accountId: id, memberships: new Map([[place.spaceId, member.role]]) }, place)
  )
    throw new Failure(409, 'ASSIGNEE_CANNOT_SEE');
  if (!canViewMembership(account.viewer, id, place.spaceId)) deny();
}
async function hasContributions(tx: Transaction, account: Account, record: ObjectRow) {
  const fields = await fieldsOf(tx, account, record.id);
  const events = await tx.select().from(objectEvents).where(eq(objectEvents.parentId, record.id));
  const accounts = await tx
    .select()
    .from(utilityAccounts)
    .where(eq(utilityAccounts.parentId, record.id));
  return (
    record.hasOtherContributions ||
    [...fields, ...events, ...accounts].some(
      (child) => child.authorId !== record.authorId || child.hasOtherContributions,
    )
  );
}
async function target(
  tx: Transaction,
  account: Account,
  record: ObjectRow,
  action: z.infer<typeof Preview>,
) {
  const place =
    action.action === 'personal'
      ? await placementFrom(tx, account)
      : { ...placementOf(record), audience: action.audience };
  const allowed =
    action.action === 'personal'
      ? canMove(account.viewer, factsOf(record), place, await hasContributions(tx, account, record))
      : canChangeAudience(account.viewer, factsOf(record), place);
  if (!allowed) deny();
  if (place.kind === 'household' && place.audience === 'adults') {
    const children = [
      ...(await fieldsOf(tx, account, record.id)),
      ...(await tx.select().from(objectEvents).where(eq(objectEvents.parentId, record.id))),
      ...(await tx.select().from(utilityAccounts).where(eq(utilityAccounts.parentId, record.id))),
    ];
    for (const id of new Set([record.assigneeId, ...children.map((child) => child.assigneeId)]))
      await responsible(tx, account, place, id ?? undefined);
  }
  return place;
}
async function lostAccess(tx: Transaction, account: Account, record: ObjectRow, place: Placement) {
  const old = placementOf(record);
  if (old.kind !== 'household') return [];
  const members = await tx
    .select({
      id: spaceMembers.accountId,
      role: spaceMembers.role,
      displayName: memberProfiles.displayName,
    })
    .from(spaceMembers)
    .innerJoin(memberProfiles, eq(memberProfiles.accountId, spaceMembers.accountId))
    .where(and(eq(spaceMembers.spaceId, old.spaceId), isNull(spaceMembers.leftAt)));
  return members
    .filter((member) => {
      const viewer = { accountId: member.id, memberships: new Map([[old.spaceId, member.role]]) };
      return (
        canViewMembership(account.viewer, member.id, old.spaceId) &&
        canView(viewer, old) &&
        !canView(viewer, place)
      );
    })
    .map(({ id, displayName }) => ({ accountId: id, displayName }));
}

export async function objectsRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('GET', '/api/objects', 200, async (tx, account, request) => {
    const query = parse(ListObjects, request.query);
    const rows = await tx
      .select()
      .from(objects)
      .where(
        and(
          query.trash === 'true'
            ? sql`${objects.deletedAt} IS NOT NULL`
            : isNull(objects.deletedAt),
          query.scope === 'all' ? undefined : eq(objects.spaceKind, query.scope),
          query.spaceId ? eq(objects.spaceId, query.spaceId) : undefined,
          query.objectType ? eq(objects.objectType, query.objectType) : undefined,
        ),
      )
      .orderBy(desc(objects.updatedAt), objects.id)
      .limit(query.limit)
      .offset(query.offset);
    return rows.filter((record) => canView(account.viewer, placementOf(record))).map(summary);
  });
  route('GET', '/api/objects/:id', 200, async (tx, account, request) =>
    card(tx, account, await getObject(tx, account, parse(Id, request.params).id)),
  );
  route('POST', '/api/objects', 201, async (tx, account, request) => {
    const body = parse(CreateObject, request.body);
    if (body.fields.some((field) => field.id)) throw new Failure(400, 'INVALID_FIELD');
    const place =
      body.objectType === 'property' && !body.placement
        ? await defaultHousePlacement(tx, account, 'adults')
        : await placementFrom(
            tx,
            account,
            body.placement?.spaceId,
            body.placement?.audience,
            body.objectType === 'property' ? 'adults' : 'household',
          );
    if (body.typeData && body.objectType !== 'property') throw new Failure(400, 'INVALID_INPUT');
    const typeData =
      body.objectType === 'property'
        ? await validateProperty(tx, account, place, body.typeData ?? {})
        : {};
    if (!canCreate(account.viewer, { type: 'object', placement: place, authorId: account.id }))
      deny();
    await responsible(tx, account, place, body.assigneeId);
    const [record] = await tx
      .insert(objects)
      .values({
        ...columnsOf(place),
        title: body.title,
        objectType: body.objectType,
        typeData,
        authorId: account.id,
        assigneeId: body.assigneeId,
      })
      .returning();
    if (!record) throw new Error('Object insert returned no row');
    await replaceFields(tx, account, record, body.fields);
    return card(tx, account, record);
  });
  route('PATCH', '/api/objects/:id', 200, async (tx, account, request) => {
    const id = parse(Id, request.params).id;
    const body = parse(PatchObject, request.body);
    const visible = await getObject(tx, account, id);
    requireWrite(account, visible);
    const record = await getObject(tx, account, id, true);
    requireWrite(account, record);
    version(body.expectedUpdatedAt, record.updatedAt);
    const requestedAssigneeId =
      body.responsibleId !== undefined ? body.responsibleId : body.assigneeId;
    const assigneeId = requestedAssigneeId === null ? record.authorId : requestedAssigneeId;
    await responsible(tx, account, placementOf(record), assigneeId);
    const objectType = body.objectType ?? record.objectType;
    if (body.typeData && objectType !== 'property') throw new Failure(400, 'INVALID_INPUT');
    const typeData =
      objectType === 'property'
        ? await validateProperty(
            tx,
            account,
            placementOf(record),
            body.typeData ?? (record.objectType === 'property' ? record.typeData : {}),
            record.typeData,
          )
        : {};
    const [updated] = await tx
      .update(objects)
      .set({
        title: body.title ?? record.title,
        objectType,
        typeData,
        assigneeId: assigneeId === undefined ? record.assigneeId : assigneeId,
      })
      .where(eq(objects.id, id))
      .returning();
    if (!updated) deny();
    if (body.fields) await replaceFields(tx, account, updated, body.fields);
    return card(tx, account, updated);
  });
  route('POST', '/api/objects/:id/access-preview', 200, async (tx, account, request) => {
    const record = await getObject(tx, account, parse(Id, request.params).id);
    const place = await target(tx, account, record, parse(Preview, request.body));
    return {
      updatedAt: record.updatedAt,
      losesAccess: await lostAccess(tx, account, record, place),
    };
  });
  for (const action of ['share', 'personal', 'copy', 'audience', 'trash', 'restore'] as const)
    route(
      'POST',
      `/api/objects/:id/${action}`,
      action === 'copy' ? 201 : 200,
      async (tx, account, request) => {
        const id = parse(Id, request.params).id;
        let record = await getObject(tx, account, id);
        const facts = factsOf(record);
        if (action === 'copy') {
          parse(Confirm, request.body ?? {});
          if (!canCopyToPersonal(account.viewer, facts)) deny();
          const place = await placementFrom(tx, account);
          const [copy] = await tx
            .insert(objects)
            .values({
              ...columnsOf(place),
              title: record.title,
              objectType: record.objectType,
              typeData: record.typeData,
              authorId: account.id,
            })
            .returning();
          if (!copy) throw new Error('Object copy returned no row');
          await replaceFields(
            tx,
            account,
            copy,
            (await fieldsOf(tx, account, id))
              .filter((field) => field.deletedAt === null)
              .map(({ title, value }) => ({ name: title, value })),
          );
          for (const child of await tx
            .select()
            .from(utilityAccounts)
            .where(and(eq(utilityAccounts.parentId, id), isNull(utilityAccounts.deletedAt)))) {
            if (!canView(account.viewer, placementOf(child))) continue;
            const provider = (await accountSummary(tx, account, child)).supplier;
            await tx.insert(utilityAccounts).values({
              ...columnsOf(place),
              parentId: copy.id,
              authorId: account.id,
              title: child.title,
              data: child.data,
              supplierId: provider?.deletedAt === null ? provider.id : null,
            });
          }
          await copyEvents(tx, account, record, copy);
          await copyFiles(tx, account, 'object', record, copy);
          return card(tx, account, copy);
        }
        let fields: Partial<typeof objects.$inferInsert>;
        if (action === 'share') {
          const body = parse(Share, request.body);
          const place: Placement = {
            kind: 'household',
            spaceId: body.spaceId,
            audience: body.audience,
          };
          if (!canMove(account.viewer, facts, place, await hasContributions(tx, account, record)))
            deny();
          fields = columnsOf(place);
        } else if (action === 'personal' || action === 'audience') {
          const body =
            action === 'personal'
              ? parse(Confirm, request.body ?? {})
              : parse(AudienceChange, request.body);
          const place = await target(
            tx,
            account,
            record,
            action === 'personal'
              ? { action }
              : { action, audience: (body as z.infer<typeof AudienceChange>).audience },
          );
          if (
            (action === 'personal' ||
              (place.kind === 'household' &&
                place.audience === 'adults' &&
                record.audience !== 'adults')) &&
            body.confirmed !== true
          )
            throw new Failure(409, 'CONFIRMATION_REQUIRED');
          fields = columnsOf(place);
        } else {
          parse(Confirm, request.body ?? {});
          if (
            action === 'trash'
              ? !canTrash(account.viewer, facts)
              : !canRestore(account.viewer, facts)
          )
            deny();
          fields = { deletedAt: action === 'trash' ? new Date() : null };
        }
        const readVersion = record.updatedAt;
        record = await getObject(tx, account, id, true);
        version(readVersion.toISOString(), record.updatedAt);
        // Под блокировкой повторяем права, включая необратимый признак чужого вклада.
        if (
          action === 'personal' &&
          !canMove(
            account.viewer,
            factsOf(record),
            await placementFrom(tx, account),
            await hasContributions(tx, account, record),
          )
        )
          deny();
        const [updated] = await tx
          .update(objects)
          .set(fields)
          .where(eq(objects.id, id))
          .returning();
        if (!updated) deny();
        return card(tx, account, updated);
      },
    );
  registerLinks(route);
  registerTimeline(route);
  route('GET', '/api/objects/export', 200, async (tx, account) => {
    const adminSpaces = [...account.viewer.memberships]
      .filter(([, role]) => role === 'admin')
      .map(([id]) => sql`${id}::uuid`);
    const eligible = adminSpaces.length
      ? sql`${objects.spaceId} IN (${sql.join(adminSpaces, sql`,`)})`
      : sql`false`;
    const exported = [];
    let after: string | undefined;
    for (;;) {
      const rows = await tx
        .select()
        .from(objects)
        .where(
          and(
            sql`(${objects.spaceKind}='personal' OR ${eligible})`,
            after ? sql`${objects.id} > ${after}::uuid` : undefined,
          ),
        )
        .orderBy(objects.id)
        .limit(100);
      if (rows.length === 0) break;
      const ids = sql.join(
        rows.map((row) => sql`${row.id}::uuid`),
        sql`,`,
      );
      const fields = await tx
        .select()
        .from(objectFields)
        .where(sql`${objectFields.parentId} IN (${ids})`)
        .orderBy(objectFields.position, objectFields.id);
      const files = await tx
        .select()
        .from(objectFiles)
        .where(sql`${objectFiles.parentId} IN (${ids})`)
        .orderBy(objectFiles.createdAt, objectFiles.id);
      const events = await exportEvents(tx, account, rows);
      for (const record of rows) {
        if (!canView(account.viewer, placementOf(record))) continue;
        exported.push({
          ...summary(record),
          fields: fields
            .filter(
              (field) =>
                field.parentId === record.id && canView(account.viewer, placementOf(field)),
            )
            .map(({ id, title, value, position, deletedAt }) => ({
              id,
              name: title,
              value,
              position,
              deletedAt,
            })),
          files: files.filter((file) => file.parentId === record.id).map(fileSummary),
          events: events.get(record.id) ?? [],
        });
      }
      if (rows.length < 100) break;
      after = rows.at(-1)?.id;
    }
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      objects: exported,
      links: await exportLinks(tx, account),
    };
  });
}
