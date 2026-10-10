import {
  and,
  eq,
  isNull,
  recordLinks,
  spaceMembers,
  sql,
  type Transaction,
  tasks,
} from '@homecrm/db';
import {
  canBeAssignee,
  canChangeAudience,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canView,
  type Placement,
  TaskData,
  TaskDataWithMissingTarget,
  TaskFields,
  TaskStatus,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Account } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { getContact } from '../contacts/routes.ts';
import { fileSummary, filesOf } from '../files/service.ts';
import { beginOperation, fingerprint, finishOperation } from '../idempotency.ts';
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
  readReference,
  requireWrite,
  tableForType,
  version,
} from '../objects/support.ts';
import { publicRecord } from '../utilities/service.ts';

const Id = z.strictObject({ id: z.uuid() });
const Place = z.strictObject({
  spaceId: z.uuid(),
  audience: z.enum(['adults', 'household']).optional(),
});
const Link = z.strictObject({
  type: z.enum(['object', 'contact', 'document', 'utility_charge']),
  id: z.uuid(),
  role: z.string().trim().max(200).default(''),
});
type Task = typeof tasks.$inferSelect;
async function getTask(tx: Transaction, account: Account, id: string, lock = false) {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  if (!lock) return row;
  if (!row.deletedAt) requireWrite(account, row, 'task');
  const [locked] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
  if (!locked) deny();
  return locked;
}
async function summary(tx: Transaction, row: Task) {
  const contact = row.waitingContactId
    ? (
        await tx.execute<{ id: string; title: string }>(
          sql`SELECT id,title FROM contacts WHERE id=${row.waitingContactId}::uuid AND deleted_at IS NULL`,
        )
      ).rows[0]
    : null;
  const member = row.waitingAccountId
    ? (
        await tx.execute<{ id: string; title: string }>(
          sql`SELECT p.account_id AS id,p.display_name AS title FROM member_profiles p WHERE p.account_id=${row.waitingAccountId}::uuid`,
        )
      ).rows[0]
    : null;
  return {
    ...publicRecord(row),
    files: (await filesOf(tx, 'task', row.id))
      .filter((file) => row.deletedAt !== null || file.deletedAt === null)
      .map(fileSummary),
    description: row.description,
    planOn: row.planOn,
    planTime: row.planTime,
    dueOn: row.dueOn,
    dueTime: row.dueTime,
    dueAt: row.dueAt,
    doneAt: row.doneAt,
    status: row.status,
    checklist: row.checklist,
    waitingContactId: contact?.id ?? null,
    waitingAccountId: member?.id ?? null,
    waitingFrom: contact ?? member ?? null,
    checkOn: row.checkOn,
    householdId: row.householdId,
  };
}
async function assignee(tx: Transaction, account: Account, place: Placement, id: string) {
  const memberships = await tx
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.accountId, id), isNull(spaceMembers.leftAt)));
  if (
    !canBeAssignee(
      { accountId: id, memberships: new Map(memberships.map((m) => [m.spaceId, m.role])) },
      place,
    )
  )
    throw new Failure(409, 'ASSIGNEE_NOT_VISIBLE');
  // Личное другого участника не принимаем даже при переданном UUID.
  if (place.kind === 'personal' && place.ownerId !== account.id) deny();
}
async function legacyHouse(tx: Transaction, account: Account, row: Task) {
  // В общем дом задан пространством. В личном видны все собственные членства автора;
  // несколько действующих домов не дают оснований выбирать один из них.
  if (row.spaceKind === 'personal' && row.authorId !== account.id) return null;
  const memberships = await tx
    .select({ spaceId: spaceMembers.spaceId })
    .from(spaceMembers)
    .where(
      and(
        eq(spaceMembers.accountId, row.authorId),
        isNull(spaceMembers.leftAt),
        row.spaceKind === 'household' ? eq(spaceMembers.spaceId, row.spaceId) : undefined,
      ),
    );
  return memberships.length === 1 ? (memberships[0]?.spaceId ?? null) : null;
}
async function waiting(
  tx: Transaction,
  account: Account,
  data: z.infer<typeof TaskFields>,
  old?: Task,
) {
  if (data.waitingContactId && data.waitingContactId !== old?.waitingContactId) {
    const contact = await getContact(tx, account, data.waitingContactId);
    if (contact.deletedAt) missing();
  }
  if (data.waitingAccountId && data.waitingAccountId !== old?.waitingAccountId) {
    const [visible] = await tx
      .execute(sql`SELECT 1 FROM member_profiles WHERE account_id=${data.waitingAccountId}::uuid`)
      .then((r) => r.rows);
    if (!visible) missing();
  }
}
export async function taskRoutes(app: FastifyInstance, module: AuthModule) {
  const route = dataRoutes(app, module);
  route('POST', '/api/tasks', 201, async (tx, account, request) => {
    const body = parse(
      TaskFields.extend({
        placement: Place.optional(),
        assigneeId: z.uuid().optional(),
        householdId: z.uuid().optional(),
        objectId: z.uuid().optional(),
        links: z.array(Link).max(100).default([]),
        idempotencyKey: z.uuid().optional(),
      }),
      request.body,
    );
    const hash = fingerprint(body);
    const prior = await beginOperation(tx, account.id, body.idempotencyKey, 'task_create', hash);
    if (prior) return summary(tx, await getTask(tx, account, prior[0] ?? ''));
    const object = body.objectId ? await getObject(tx, account, body.objectId) : null;
    if (object?.deletedAt) missing();
    const place = body.placement
      ? await placementFrom(tx, account, body.placement.spaceId, body.placement.audience)
      : object
        ? placementOf(object)
        : await placementFrom(tx, account);
    const assigned = body.assigneeId ?? (place.kind === 'personal' ? place.ownerId : account.id);
    await assignee(tx, account, place, assigned);
    if (
      !canCreate(account.viewer, {
        placement: place,
        type: 'task',
        authorId: account.id,
        assigneeId: assigned,
      })
    )
      deny();
    const data = parse(TaskData, TaskFields.strip().parse(body));
    await waiting(tx, account, data);
    const house =
      place.kind === 'household'
        ? place.spaceId
        : (body.householdId ?? [...account.viewer.memberships.keys()].sort()[0] ?? null);
    if (house && !account.viewer.memberships.has(house)) deny();
    if ((data.planOn || data.dueOn || data.checkOn) && !house)
      throw new Failure(400, 'HOUSE_REQUIRED');
    const { idempotencyKey: _key, placement: _place, objectId: _object, links, ...fields } = body;
    const [row] = await tx
      .insert(tasks)
      .values({
        ...fields,
        ...columnsOf(place),
        authorId: account.id,
        assigneeId: assigned,
        householdId: house,
        doneAt: data.status === 'done' ? new Date() : null,
      })
      .returning();
    if (!row) deny();
    const refs = [
      ...links,
      ...(body.objectId ? [{ type: 'object' as const, id: body.objectId, role: '' }] : []),
    ];
    const seen = new Set<string>();
    for (const ref of refs) {
      const key = `${ref.type}:${ref.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = await readReference(tx, account, ref);
      if (target.row.deletedAt) missing();
      await tx.insert(recordLinks).values({
        leftTable: 'tasks',
        leftId: row.id,
        rightTable: tableForType(ref.type),
        rightId: ref.id,
        role: ref.role,
        authorId: account.id,
      });
    }
    await finishOperation(tx, account.id, body.idempotencyKey, 'task_create', hash, [row.id]);
    return summary(tx, row);
  });
  route('GET', '/api/tasks', 200, async (tx, account, request) => {
    const q = parse(
      z.strictObject({
        filter: z.enum(['mine', 'assigned', 'undated', 'waiting']).optional(),
        status: TaskStatus.optional(),
        objectId: z.uuid().optional(),
        scope: z.enum(['all', 'personal', 'household']).default('all'),
        trash: z.enum(['true', 'false']).default('false'),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(50000).default(0),
      }),
      request.query,
    );
    const rows = await tx
      .select()
      .from(tasks)
      .where(
        and(
          q.trash === 'true' ? sql`${tasks.deletedAt} IS NOT NULL` : isNull(tasks.deletedAt),
          q.scope === 'all' ? undefined : eq(tasks.spaceKind, q.scope),
          q.status ? eq(tasks.status, q.status) : undefined,
          q.filter === 'mine'
            ? eq(tasks.assigneeId, account.id)
            : q.filter === 'assigned'
              ? and(eq(tasks.authorId, account.id), sql`${tasks.assigneeId}<>${account.id}::uuid`)
              : q.filter === 'undated'
                ? isNull(tasks.planOn)
                : q.filter === 'waiting'
                  ? eq(tasks.status, 'waiting')
                  : undefined,
          q.objectId
            ? sql`EXISTS (SELECT 1 FROM record_links l JOIN objects o ON o.id=${q.objectId}::uuid AND o.deleted_at IS NULL WHERE l.deleted_at IS NULL AND ((l.left_table='tasks' AND l.left_id=tasks.id AND l.right_table='objects' AND l.right_id=o.id) OR (l.right_table='tasks' AND l.right_id=tasks.id AND l.left_table='objects' AND l.left_id=o.id)))`
            : undefined,
        ),
      )
      .orderBy(tasks.planOn, tasks.planTime, tasks.id)
      .limit(q.limit)
      .offset(q.offset);
    return Promise.all(
      rows
        .filter((row) => canView(account.viewer, placementOf(row)))
        .map(async (row) => ({
          ...(await summary(tx, row)),
          canRestore: !!row.deletedAt && canRestore(account.viewer, factsOf(row, 'task')),
        })),
    );
  });
  route('GET', '/api/tasks/:id', 200, async (tx, account, request) =>
    summary(tx, await getTask(tx, account, parse(Id, request.params).id)),
  );
  for (const action of ['patch', 'status'] as const)
    route(
      action === 'patch' ? 'PATCH' : 'POST',
      action === 'patch' ? '/api/tasks/:id' : '/api/tasks/:id/status',
      200,
      async (tx, account, request) => {
        const id = parse(Id, request.params).id;
        const body =
          action === 'patch'
            ? parse(
                z
                  .strictObject({
                    title: TaskFields.shape.title.optional(),
                    description: z.string().max(20000).optional(),
                    planOn: TaskFields.shape.planOn.unwrap().optional(),
                    planTime: TaskFields.shape.planTime.unwrap().optional(),
                    dueOn: TaskFields.shape.dueOn.unwrap().optional(),
                    dueTime: TaskFields.shape.dueTime.unwrap().optional(),
                    status: TaskStatus.optional(),
                    waitingContactId: z.uuid().nullable().optional(),
                    waitingAccountId: z.uuid().nullable().optional(),
                    checkOn: z.iso.date().nullable().optional(),
                    checklist: TaskFields.shape.checklist.unwrap().optional(),
                  })
                  .extend({
                    assigneeId: z.uuid().optional(),
                    expectedUpdatedAt: z.iso.datetime().optional(),
                    idempotencyKey: z.uuid().optional(),
                  })
                  .refine((b) =>
                    Object.keys(b).some(
                      (k) => !['expectedUpdatedAt', 'idempotencyKey'].includes(k),
                    ),
                  ),
                request.body,
              )
            : parse(
                z.strictObject({
                  status: TaskStatus,
                  waitingContactId: z.uuid().nullable().optional(),
                  waitingAccountId: z.uuid().nullable().optional(),
                  checkOn: z.iso.date().nullable().optional(),
                  expectedUpdatedAt: z.iso.datetime().optional(),
                  idempotencyKey: z.uuid().optional(),
                }),
                request.body,
              );
        const operation = action === 'patch' ? 'task_patch' : 'task_status',
          hash = fingerprint({ id, body });
        const prior = await beginOperation(tx, account.id, body.idempotencyKey, operation, hash);
        if (prior) return summary(tx, await getTask(tx, account, id));
        const row = await getTask(tx, account, id, true);
        requireWrite(account, row, 'task');
        version(body.expectedUpdatedAt, row.updatedAt);
        // Null из формы скрытого контакта не удаляет существующую связь.
        if (body.waitingContactId === null && row.waitingContactId) {
          const visible = (
            await tx.execute(
              sql`SELECT 1 FROM contacts WHERE id=${row.waitingContactId}::uuid AND deleted_at IS NULL`,
            )
          ).rowCount;
          if (!visible) delete body.waitingContactId;
        }
        if (body.waitingAccountId === null && row.waitingAccountId) {
          const visible = (
            await tx.execute(
              sql`SELECT 1 FROM member_profiles WHERE account_id=${row.waitingAccountId}::uuid`,
            )
          ).rowCount;
          if (!visible) delete body.waitingAccountId;
        }
        const retainedMissingTarget =
          row.status === 'waiting' &&
          !row.waitingContactId &&
          !row.waitingAccountId &&
          body.waitingContactId === undefined &&
          body.waitingAccountId === undefined;
        const merged = parse(
          retainedMissingTarget ? TaskDataWithMissingTarget : TaskData,
          TaskFields.strip().parse({ ...row, ...body }),
        );
        await waiting(tx, account, merged, row);
        const assigned =
          'assigneeId' in body && body.assigneeId
            ? body.assigneeId
            : (row.assigneeId ?? account.id);
        await assignee(tx, account, placementOf(row), assigned);
        const dated = !!(merged.planOn || merged.dueOn || merged.checkOn);
        const house = row.householdId ?? (dated ? await legacyHouse(tx, account, row) : null);
        if (dated && !house) throw new Failure(400, 'HOUSE_REQUIRED');
        const { expectedUpdatedAt: _version, idempotencyKey: _key, ...fields } = body;
        const changed =
          house !== row.householdId ||
          Object.entries(fields).some(
            ([key, value]) => JSON.stringify(row[key as keyof Task]) !== JSON.stringify(value),
          );
        let result = row;
        if (changed) {
          const [updated] = await tx
            .update(tasks)
            .set({
              ...fields,
              householdId: house,
              doneAt: merged.status === 'done' ? (row.doneAt ?? new Date()) : null,
            })
            .where(eq(tasks.id, id))
            .returning();
          if (!updated) deny();
          result = updated;
        }
        await finishOperation(tx, account.id, body.idempotencyKey, operation, hash, [id]);
        return summary(tx, result);
      },
    );
  route('GET', '/api/tasks/:id/history', 200, async (tx, account, request) => {
    const row = await getTask(tx, account, parse(Id, request.params).id);
    return (
      await tx.execute(
        sql`SELECT * FROM tasks_history WHERE record_id=${row.id}::uuid ORDER BY created_at,id`,
      )
    ).rows;
  });
  route('POST', '/api/tasks/:id/move', 200, async (tx, account, request) => {
    const body = parse(
      Place.extend({ confirmed: z.literal(true), assigneeId: z.uuid().optional() }),
      request.body,
    );
    const row = await getTask(tx, account, parse(Id, request.params).id, true);
    const target = await placementFrom(tx, account, body.spaceId, body.audience);
    if (
      !(row.spaceId === target.spaceId
        ? canChangeAudience(account.viewer, factsOf(row, 'task'), target)
        : canMove(account.viewer, factsOf(row, 'task'), target, row.hasOtherContributions))
    )
      deny();
    const assigned =
      target.kind === 'personal' ? account.id : (body.assigneeId ?? row.assigneeId ?? account.id);
    await assignee(tx, account, target, assigned);
    const [result] = await tx
      .update(tasks)
      .set({
        ...columnsOf(target),
        assigneeId: assigned,
        householdId: target.kind === 'household' ? target.spaceId : row.householdId,
      })
      .where(eq(tasks.id, row.id))
      .returning();
    if (!result) deny();
    return summary(tx, result);
  });
  for (const action of ['trash', 'restore'] as const) {
    const handler = async (
      tx: Transaction,
      account: Account,
      request: { params: unknown; body?: unknown },
    ) => {
      parse(z.strictObject({}), request.body ?? {});
      const row = await getTask(tx, account, parse(Id, request.params).id, true);
      if (!(action === 'trash' ? canTrash : canRestore)(account.viewer, factsOf(row, 'task')))
        deny();
      if (!!row.deletedAt === (action === 'trash')) return summary(tx, row);
      const [result] = await tx
        .update(tasks)
        .set({ deletedAt: action === 'trash' ? new Date() : null })
        .where(eq(tasks.id, row.id))
        .returning();
      if (!result) deny();
      return summary(tx, result);
    };
    route('POST', `/api/tasks/:id/${action}`, 200, handler);
    if (action === 'trash') route('DELETE', '/api/tasks/:id', 200, handler);
  }
}
