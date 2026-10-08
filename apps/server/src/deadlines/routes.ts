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
import { chargeSummary, createPayment, getCharge } from '../utilities/charges.ts';

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
    const { from, to } = parse(
      z.strictObject({ from: CalendarDate, to: CalendarDate }).refine((x) => x.from <= x.to),
      request.query,
    );
    return options.appDb.withAccount(account.id, async (tx) => {
      // План с вложенным RLS дороже компилировать, чем выполнить на сотнях сроков.
      await tx.execute(sql`SET LOCAL jit=off`);
      type RadarRow = typeof deadlineOccurrencesTable.$inferSelect & {
        documentId: string | null;
        noteId: string | null;
        objectId: string | null;
        title: string;
        rule: typeof DeadlineRule._output;
        sourceKind: 'record' | 'readings' | 'payment' | 'verification' | 'document';
        object: { id: string; title: string; status: string | null } | null;
        utilityAccount: { id: string; title: string; number: string; transmission: unknown } | null;
        meter: { id: string; title: string } | null;
        needsMeters: boolean;
        chargeId: string | null;
      };
      // Те же условия DEAD-5, что у app.utility_window_open, над наборами под RLS:
      // материализация не запускает отдельный SQL-план с политиками на каждое окно.
      // Источники по ID и проверка пояса соединяются с исходными таблицами под RLS:
      // их индексы исключают повторные полные проходы по материализованным наборам.
      const result = await tx.execute<{ items: RadarRow[]; recalculating: boolean }>(sql`
        WITH visible_deadlines AS MATERIALIZED (SELECT * FROM deadlines),
        visible_occurrences AS MATERIALIZED (SELECT * FROM deadline_occurrences),
        visible_meters AS MATERIALIZED (SELECT id,title,utility_account_id,is_active,deleted_at FROM meters),
        visible_charges AS MATERIALIZED (SELECT id,parent_id,period,is_paid,deleted_at,cancelled_at FROM utility_charges),
        visible_readings AS MATERIALIZED (SELECT parent_id,occurred_on,transmitted_at,deleted_at FROM meter_readings),
        radar AS (
          SELECT o.id,o.deadline_id AS "deadlineId",o.date,o.starts_at AS "startsAt",o.ends_at AS "endsAt",o.time_zone AS "timeZone",
           o.warnings_at AS "warningsAt",o.completed_at AS "completedAt",o.space_id AS "spaceId",o.space_kind AS "spaceKind",o.audience,
           o.author_id AS "authorId",o.assignee_id AS "assigneeId",o.deleted_at AS "deletedAt",
           d.document_id AS "documentId",d.note_id AS "noteId",d.object_id AS "objectId",d.rule,d.source_kind AS "sourceKind",coalesce(d.label,n.title,p.title,doc.title) AS title,d.charge_id AS "chargeId",
           CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'title',p.title,'status',p.type_data->>'status') END AS object,
           CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'title',a.title,'number',a.data->>'number','transmission',a.data->'transmission') END AS "utilityAccount",
           (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM visible_meters vm WHERE vm.utility_account_id=d.utility_account_id AND vm.is_active AND vm.deleted_at IS NULL)) AS "needsMeters",
           CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('id',m.id,'title',m.title) END AS meter
          FROM visible_occurrences o JOIN visible_deadlines d ON d.id=o.deadline_id
          LEFT JOIN documents doc ON doc.id=d.document_id LEFT JOIN notes n ON n.id=d.note_id LEFT JOIN objects p ON p.id=d.object_id
          LEFT JOIN utility_accounts a ON a.id=d.utility_account_id LEFT JOIN meters m ON m.id=d.meter_id
          WHERE o.date<=${to} AND d.deleted_at IS NULL AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND doc.deleted_at IS NULL AND (d.document_id IS NULL OR (doc.id IS NOT NULL AND doc.status='valid'))
           AND (d.source_kind<>'payment' OR CASE WHEN d.charge_id IS NOT NULL THEN EXISTS (SELECT 1 FROM visible_charges c WHERE c.id=d.charge_id AND c.deleted_at IS NULL AND c.cancelled_at IS NULL AND NOT c.is_paid) ELSE NOT EXISTS (SELECT 1 FROM visible_charges c WHERE c.parent_id=d.utility_account_id AND c.deleted_at IS NULL AND c.cancelled_at IS NULL AND c.period=to_char(o.date-interval '1 month','YYYY-MM')) END)
           AND (d.source_kind<>'readings' OR (
            (o.ends_at>=CURRENT_TIMESTAMP AND o.completed_at IS NULL AND NOT EXISTS (SELECT 1 FROM visible_meters m WHERE m.utility_account_id=d.utility_account_id AND m.is_active AND m.deleted_at IS NULL))
            OR EXISTS (SELECT 1 FROM visible_meters m WHERE m.utility_account_id=d.utility_account_id AND m.is_active AND m.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM visible_readings r WHERE r.parent_id=m.id AND r.deleted_at IS NULL AND r.transmitted_at IS NOT NULL
              AND r.occurred_on BETWEEN (o.starts_at AT TIME ZONE o.time_zone)::date AND (o.ends_at AT TIME ZONE o.time_zone)::date))))
          ORDER BY o.starts_at,o.id
        ) SELECT coalesce(jsonb_agg(radar),'[]'::jsonb) AS items,
          (EXISTS (SELECT 1 FROM visible_deadlines d WHERE d.deleted_at IS NULL AND d.needs_refresh)
           OR EXISTS (SELECT 1 FROM visible_occurrences o JOIN visible_deadlines d ON d.id=o.deadline_id
            JOIN spaces s ON s.id=d.household_id WHERE d.deleted_at IS NULL AND o.time_zone<>s.time_zone)) AS recalculating
        FROM radar`);
      const rows = (result.rows[0]?.items ?? []).map((x) => ({
        ...x,
        startsAt: new Date(x.startsAt),
        endsAt: new Date(x.endsAt),
      }));
      const now = new Date();
      // Многие коммунальные сроки приходятся на один день. Преобразуем одинаковые
      // моменты в пояс дома один раз на ответ, без кэша между пользователями.
      const endDates = new Map<string, string>();
      const radarGroups = new Map<string, ReturnType<typeof radarGroup>>();
      const endDate = (x: (typeof rows)[number]) => {
        const key = `${x.timeZone}:${+x.endsAt}`;
        if (!endDates.has(key)) endDates.set(key, localDate(x.endsAt, x.timeZone));
        return endDates.get(key) as string;
      };
      const groupFor = (x: (typeof rows)[number]) => {
        const key = `${x.timeZone}:${+x.startsAt}:${+x.endsAt}`;
        if (!radarGroups.has(key)) radarGroups.set(key, radarGroup(x, now, x.timeZone));
        const group = radarGroups.get(key) ?? null;
        return (
          group ??
          (x.sourceKind === 'document' && x.warningsAt.some((date) => new Date(date) <= now)
            ? 'later'
            : null)
        );
      };
      const items = rows
        .filter(
          (x) =>
            (x.completedAt === null || (x.sourceKind === 'readings' && !x.needsMeters)) &&
            endDate(x) >= from,
        )
        .map((x) => ({
          ...x,
          group: groupFor(x),
          primaryAction:
            x.sourceKind === 'readings'
              ? {
                  kind: 'enter_readings',
                  label: 'Внести показания',
                  objectId: x.objectId,
                  ...(x.needsMeters
                    ? {
                        hint: 'Добавьте счётчики',
                        completionAction: {
                          kind: 'mark_readings',
                          label: 'Передано',
                          occurrenceId: x.id,
                        },
                      }
                    : {}),
                }
              : x.sourceKind === 'payment'
                ? { kind: 'mark_payment', label: 'Отметить оплату', occurrenceId: x.id }
                : x.sourceKind === 'verification'
                  ? { kind: 'verify_meter', label: 'Поверка проведена', meterId: x.meter?.id }
                  : null,
        }))
        .filter((x) => x.group !== null);
      return {
        items,
        recalculating: result.rows[0]?.recalculating ?? false,
        groups: Object.fromEntries(
          [...RADAR_GROUPS, ...(items.some((x) => x.group === 'later') ? ['later'] : [])].map(
            (group) => [group, items.filter((x) => x.group === group).length],
          ),
        ),
      };
    });
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
            if (summary.remainingCents > 0)
              await createPayment(tx, account, charge, {
                paidOn: localDate(new Date(), item.occurrence.timeZone),
                amountCents: summary.remainingCents,
                payer: { kind: 'member', accountId: account.id },
                method: 'card',
                receiptId: null,
              });
            return {
              ...item.occurrence,
              completedAt: new Date().toISOString(),
              chargeId: charge.id,
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
        return updated;
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
