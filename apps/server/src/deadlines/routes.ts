import {
  and,
  deadlineOccurrencesTable,
  deadlines,
  eq,
  getTableColumns,
  isNotNull,
  isNull,
  notes,
  objects,
  spaces,
  sql,
} from '@homecrm/db';
import {
  CalendarDate,
  canRestore,
  canViewDeadline,
  canWriteDeadline,
  DeadlineRule,
  localDate,
  RADAR_GROUPS,
  radarGroup,
  TimeZone,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import { pgError } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';
import { placementOf } from '../notes/routes.ts';
import { Failure } from '../objects/support.ts';

const Source = z.strictObject({ source: z.enum(['notes', 'objects']), sourceId: z.uuid() });
const Id = z.strictObject({ id: z.uuid() });
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Failure(400, 'INVALID_INPUT');
  return result.data;
}
export async function deadlinesRoutes(app: FastifyInstance, options: AuthModule) {
  const currentAccount = createAccountReader(options);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ code: error.code });
    const { code } = pgError(error);
    if (code === '42501') return reply.code(403).send({ code: 'ACCESS_DENIED' });
    if (code === '23503' || code === '23514')
      return reply.code(400).send({ code: 'INVALID_INPUT' });
    app.log.error(
      { databaseCode: /^[A-Z0-9]{5}$/.test(code ?? '') ? code : undefined },
      'Deadline request failed',
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  app.get('/api/:source/:sourceId/deadlines', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { source, sourceId } = parse(Source, request.params);
    return options.appDb.withAccount(account.id, async (tx) => {
      const table = source === 'notes' ? notes : objects;
      const [parent] = await tx.select().from(table).where(eq(table.id, sourceId));
      if (
        !parent ||
        parent.deletedAt !== null ||
        !canViewDeadline(account.viewer, {
          type: source === 'notes' ? 'note' : 'object',
          placement: placementOf(parent),
          authorId: parent.authorId,
          trashed: parent.deletedAt !== null,
        })
      )
        throw new Failure(404, 'NOT_FOUND');
      return tx
        .select()
        .from(deadlines)
        .where(
          and(
            eq(source === 'notes' ? deadlines.noteId : deadlines.objectId, sourceId),
            isNull(deadlines.deletedAt),
          ),
        );
    });
  });
  app.post('/api/:source/:sourceId/deadlines', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { source, sourceId } = parse(Source, request.params);
    const body = parse(
      z.strictObject({ rule: DeadlineRule, householdId: z.uuid().optional() }),
      request.body,
    );
    const created = await options.appDb.withAccount(account.id, async (tx) => {
      const table = source === 'notes' ? notes : objects;
      const [parent] = await tx.select().from(table).where(eq(table.id, sourceId)).for('update');
      if (!parent || parent.deletedAt !== null) throw new Failure(404, 'NOT_FOUND');
      if (
        !canWriteDeadline(account.viewer, {
          type: source === 'notes' ? 'note' : 'object',
          placement: placementOf(parent),
          authorId: parent.authorId,
          trashed: false,
        })
      )
        throw new Failure(403, 'ACCESS_DENIED');
      const householdId =
        parent.spaceKind === 'household'
          ? parent.spaceId
          : (body.householdId ?? [...account.viewer.memberships.keys()].sort()[0]);
      if (!householdId || !account.viewer.memberships.has(householdId))
        throw new Failure(400, 'HOUSE_REQUIRED');
      const [item] = await tx
        .insert(deadlines)
        .values({
          noteId: source === 'notes' ? sourceId : null,
          objectId: source === 'objects' ? sourceId : null,
          householdId,
          rule: body.rule,
          spaceId: parent.spaceId,
          spaceKind: parent.spaceKind,
          audience: parent.audience,
          authorId: account.id,
          assigneeId: parent.assigneeId ?? account.id,
        })
        .returning();
      return item;
    });
    return reply.code(201).send(created);
  });
  for (const method of ['PATCH', 'DELETE', 'POST'] as const)
    app.route({
      method,
      url: method === 'POST' ? '/api/deadlines/:id/restore' : '/api/deadlines/:id',
      handler: async (request, reply) => {
        const account = await currentAccount(request, reply);
        if (!account) return reply;
        const { id } = parse(Id, request.params);
        const body =
          method === 'PATCH' ? parse(z.strictObject({ rule: DeadlineRule }), request.body) : null;
        return options.appDb.withAccount(account.id, async (tx) => {
          const [item] = await tx
            .select()
            .from(deadlines)
            .where(
              and(
                eq(deadlines.id, id),
                method === 'POST' ? isNotNull(deadlines.deletedAt) : isNull(deadlines.deletedAt),
              ),
            );
          if (!item) throw new Failure(404, 'NOT_FOUND');
          const table = item.noteId ? notes : objects;
          const [parent] = await tx
            .select()
            .from(table)
            .where(eq(table.id, item.noteId ?? item.objectId ?? ''))
            .for('update');
          if (
            !parent ||
            parent.deletedAt !== null ||
            (method === 'POST' &&
              !canRestore(account.viewer, {
                type: item.noteId ? 'note' : 'object',
                placement: placementOf(parent),
                authorId: item.authorId,
                trashed: true,
              })) ||
            !canWriteDeadline(account.viewer, {
              type: item.noteId ? 'note' : 'object',
              placement: placementOf(parent),
              authorId: parent.authorId,
              trashed: parent.deletedAt !== null,
            })
          )
            throw new Failure(403, 'ACCESS_DENIED');
          const [changed] = await tx
            .update(deadlines)
            .set(body ? { rule: body.rule } : { deletedAt: method === 'POST' ? null : sql`now()` })
            .where(
              and(
                eq(deadlines.id, id),
                method === 'POST' ? isNotNull(deadlines.deletedAt) : isNull(deadlines.deletedAt),
              ),
            )
            .returning();
          if (!changed) throw new Failure(409, 'CONFLICT');
          return changed;
        });
      },
    });
  app.get('/api/deadlines', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { from, to } = parse(
      z.strictObject({ from: CalendarDate, to: CalendarDate }).refine((x) => x.from <= x.to),
      request.query,
    );
    return options.appDb.withAccount(account.id, async (tx) => {
      // План с вложенным RLS дороже компилировать, чем выполнить на сотнях сроков.
      await tx.execute(sql`SET LOCAL jit=off`);
      const rows = await tx
        .select({
          ...getTableColumns(deadlineOccurrencesTable),
          noteId: deadlines.noteId,
          objectId: deadlines.objectId,
          rule: deadlines.rule,
          title: sql<string>`coalesce(${notes.title}, ${objects.title})`,
        })
        .from(deadlineOccurrencesTable)
        .innerJoin(deadlines, eq(deadlines.id, deadlineOccurrencesTable.deadlineId))
        .leftJoin(notes, eq(notes.id, deadlines.noteId))
        .leftJoin(objects, eq(objects.id, deadlines.objectId))
        .where(
          and(
            sql`${deadlineOccurrencesTable.date} <= ${to}`,
            isNull(notes.deletedAt),
            isNull(objects.deletedAt),
          ),
        )
        .orderBy(deadlineOccurrencesTable.startsAt, deadlineOccurrencesTable.id);
      const now = new Date();
      const items = rows
        .filter((x) => x.completedAt === null && localDate(x.endsAt, x.timeZone) >= from)
        .map((x) => ({ ...x, group: radarGroup(x, now, x.timeZone) }))
        .filter((x) => x.group !== null);
      return {
        items,
        recalculating:
          (
            await tx
              .select({ id: deadlines.id })
              .from(deadlines)
              .leftJoin(spaces, eq(spaces.id, deadlines.householdId))
              .where(
                and(
                  isNull(deadlines.deletedAt),
                  sql`(${deadlines.needsRefresh} OR EXISTS (SELECT 1 FROM deadline_occurrences o WHERE o.deadline_id=${deadlines.id} AND o.time_zone<>${spaces.timeZone}))`,
                ),
              )
              .limit(1)
          ).length > 0,
        groups: Object.fromEntries(
          RADAR_GROUPS.map((group) => [group, items.filter((x) => x.group === group).length]),
        ),
      };
    });
  });
  app.get('/api/deadlines/trash', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    return options.appDb.withAccount(account.id, (tx) =>
      tx
        .select({
          ...getTableColumns(deadlines),
          title: sql<string>`coalesce(${notes.title}, ${objects.title})`,
          sourceTrashed: sql<boolean>`coalesce(${notes.deletedAt}, ${objects.deletedAt}) IS NOT NULL`,
        })
        .from(deadlines)
        .leftJoin(notes, eq(notes.id, deadlines.noteId))
        .leftJoin(objects, eq(objects.id, deadlines.objectId))
        .where(isNotNull(deadlines.deletedAt))
        .orderBy(deadlines.deletedAt, deadlines.id)
        .then((rows) =>
          rows.map((item) => ({
            ...item,
            canRestore:
              !item.sourceTrashed &&
              canRestore(account.viewer, {
                type: item.noteId ? 'note' : 'object',
                placement: placementOf(item),
                authorId: item.authorId,
                trashed: true,
              }),
          })),
        ),
    );
  });
  app.patch('/api/households/:householdId/time-zone', async (request, reply) => {
    const account = await currentAccount(request, reply);
    if (!account) return reply;
    const { householdId } = parse(z.strictObject({ householdId: z.uuid() }), request.params);
    const { timeZone } = parse(z.strictObject({ timeZone: TimeZone }), request.body);
    if (account.viewer.memberships.get(householdId) !== 'admin')
      throw new Failure(403, 'ACCESS_DENIED');
    return options.appDb.withAccount(account.id, async (tx) => {
      const [house] = await tx
        .update(spaces)
        .set({ timeZone })
        .where(eq(spaces.id, householdId))
        .returning({ householdId: spaces.id, timeZone: spaces.timeZone });
      if (!house) throw new Failure(404, 'NOT_FOUND');
      return house;
    });
  });
}
