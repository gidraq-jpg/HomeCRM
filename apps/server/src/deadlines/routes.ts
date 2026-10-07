import {
  and,
  deadlineOccurrencesTable,
  deadlines,
  eq,
  isNull,
  notes,
  objects,
  spaces,
  sql,
} from '@homecrm/db';
import {
  CalendarDate,
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
  for (const method of ['PATCH', 'DELETE'] as const)
    app.route({
      method,
      url: '/api/deadlines/:id',
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
            .where(and(eq(deadlines.id, id), isNull(deadlines.deletedAt)));
          if (!item) throw new Failure(404, 'NOT_FOUND');
          const table = item.noteId ? notes : objects;
          const [parent] = await tx
            .select()
            .from(table)
            .where(eq(table.id, item.noteId ?? item.objectId ?? ''))
            .for('update');
          if (
            !parent ||
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
            .set(body ? { rule: body.rule } : { deletedAt: sql`now()` })
            .where(and(eq(deadlines.id, id), isNull(deadlines.deletedAt)))
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
      const rows = await tx
        .select()
        .from(deadlineOccurrencesTable)
        .where(sql`date <= ${to}`)
        .orderBy(deadlineOccurrencesTable.startsAt, deadlineOccurrencesTable.id);
      const now = new Date();
      const items = rows
        .filter((x) => x.completedAt === null && localDate(x.endsAt, x.timeZone) >= from)
        .map((x) => ({ ...x, group: radarGroup(x, now, x.timeZone) }))
        .filter((x) => x.group !== null);
      return {
        items,
        groups: Object.fromEntries(
          RADAR_GROUPS.map((group) => [group, items.filter((x) => x.group === group).length]),
        ),
      };
    });
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
