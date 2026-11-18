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
  canRestore,
  canViewDeadline,
  canWriteDeadline,
  DeadlineRule,
  localDate,
  RadarFilters,
  RadarResponse,
  TimeZone,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/module.ts';
import { pgError } from '../auth/provision.ts';
import { placementOf } from '../notes/cards.ts';
import { offlineSnapshot } from '../records/snapshot.ts';
import { Failure } from '../records/support.ts';
import { chargeSummary, createPayment, getCharge } from '../utilities/charges.ts';
import { radarActionRoutes } from './actions.ts';
import { readRadar } from './radar.ts';

const Source = z.strictObject({ source: z.enum(['notes', 'objects']), sourceId: z.uuid() });
const Id = z.strictObject({ id: z.uuid() });
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Failure(400, 'INVALID_INPUT');
  return result.data;
}
export async function deadlinesRoutes(app: FastifyInstance, options: AuthModule) {
  await radarActionRoutes(app, options);
  const currentAccount = createAccountReader(options);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ code: error.code });
    const { code } = pgError(error);
    if (code === '40P01' || code === '40001') return reply.code(409).send({ code: 'CONFLICT' });
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
            eq(deadlines.sourceKind, 'record'),
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
          method === 'PATCH'
            ? parse(
                z.strictObject({
                  rule: DeadlineRule,
                  label: z.string().trim().min(1).max(200).nullable().optional(),
                }),
                request.body,
              )
            : null;
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
          if (item.sourceKind !== 'record') throw new Failure(409, 'EDIT_UTILITY_SOURCE');
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
            .set(
              body
                ? { rule: body.rule, ...(body.label !== undefined ? { label: body.label } : {}) }
                : { deletedAt: method === 'POST' ? null : sql`now()` },
            )
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
    const { offline, ...rawFilters } = request.query as Record<string, unknown>;
    if (offline !== undefined) parse(z.literal('true'), offline);
    const filters = parse(RadarFilters, rawFilters);
    const { from, to } = filters;
    if (filters.householdId && !account.viewer.memberships.has(filters.householdId))
      throw new Failure(404, 'NOT_FOUND');
    return options.appDb.withAccount(
      account.id,
      async (tx) => {
        const result = await readRadar(tx, from, to, filters);
        const data = RadarResponse.parse(JSON.parse(JSON.stringify(result)));
        return offline ? offlineSnapshot(tx, account.id, null, data) : data;
      },
      offline ? { isolationLevel: 'repeatable read' } : undefined,
    );
  });
  for (const action of ['complete-payment', 'complete-readings'] as const)
    app.post(`/api/deadlines/occurrences/:id/${action}`, async (request, reply) => {
      const account = await currentAccount(request, reply);
      if (!account) return reply;
      const { id } = parse(Id, request.params);
      const { completed } = parse(
        z.strictObject({ completed: z.boolean().default(true) }),
        request.body ?? {},
      );
      return options.appDb.withAccount(account.id, async (tx) => {
        const [item] = await tx
          .select({ occurrence: deadlineOccurrencesTable, deadline: deadlines })
          .from(deadlineOccurrencesTable)
          .innerJoin(deadlines, eq(deadlines.id, deadlineOccurrencesTable.deadlineId))
          .where(eq(deadlineOccurrencesTable.id, id));
        if (!item || item.deadline.deletedAt !== null) throw new Failure(404, 'NOT_FOUND');
        if (item.deadline.sourceKind !== (action === 'complete-payment' ? 'payment' : 'readings'))
          throw new Failure(
            409,
            action === 'complete-payment' ? 'NOT_A_PAYMENT' : 'NOT_A_READINGS_WINDOW',
          );
        const [parent] = await tx
          .select()
          .from(objects)
          .where(eq(objects.id, item.deadline.objectId ?? ''))
          .for('update');
        if (
          !parent ||
          !canWriteDeadline(account.viewer, {
            type: 'object',
            placement: placementOf(parent),
            authorId: parent.authorId,
            trashed: parent.deletedAt !== null,
          })
        )
          throw new Failure(403, 'ACCESS_DENIED');
        if (action === 'complete-payment') {
          const matched = item.deadline.chargeId
            ? [{ id: item.deadline.chargeId }]
            : (
                await tx.execute<{ id: string }>(
                  sql`SELECT id FROM utility_charges WHERE parent_id=${item.deadline.utilityAccountId}::uuid AND period=to_char(${item.occurrence.date}::date-interval '1 month','YYYY-MM') AND deleted_at IS NULL AND cancelled_at IS NULL ORDER BY id`,
                )
              ).rows;
          if (matched.length) {
            if (!completed) throw new Failure(409, 'CANCEL_PAYMENT_WITH_REASON');
            if (matched.length > 1) throw new Failure(409, 'SELECT_CHARGE');
            const charge = await getCharge(tx, account, matched[0]?.id ?? '', true);
            const summary = await chargeSummary(tx, charge);
            const payment =
              summary.remainingCents > 0
                ? await createPayment(tx, account, charge, {
                    paidOn: localDate(new Date(), item.occurrence.timeZone),
                    amountCents: summary.remainingCents,
                    payer: { kind: 'member', accountId: account.id },
                    method: 'card',
                    receiptId: null,
                  })
                : null;
            return {
              ...item.occurrence,
              completedAt: new Date().toISOString(),
              chargeId: charge.id,
              paymentId: payment?.id ?? null,
            };
          }
        }
        if (
          action === 'complete-readings' &&
          (
            await tx.execute(sql`SELECT 1 FROM meters
        WHERE utility_account_id=${item.deadline.utilityAccountId} AND is_active AND deleted_at IS NULL LIMIT 1`)
          ).rowCount
        )
          throw new Failure(409, 'ACTIVE_METERS_EXIST');
        const [updated] = await tx
          .update(deadlineOccurrencesTable)
          .set({ completedAt: completed ? sql`coalesce(completed_at,now())` : null })
          .where(eq(deadlineOccurrencesTable.id, id))
          .returning();
        if (!updated) throw new Failure(409, 'CONFLICT');
        return action === 'complete-payment' ? { ...updated, paymentId: null } : updated;
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
        .where(and(isNotNull(deadlines.deletedAt), eq(deadlines.sourceKind, 'record')))
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
