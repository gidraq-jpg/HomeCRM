import { sql, tasks } from '@homecrm/db';
import { localDate, shiftTaskDate, TaskFeedObject, TimeZone } from '@homecrm/shared';
import { z } from 'zod';
import { readRadar } from '../deadlines/routes.ts';
import { type DataRoute, Failure, parse } from '../objects/support.ts';
import { summaries } from './routes.ts';

const Query = z.strictObject({
  householdId: z.uuid().optional(),
  scope: z.enum(['all', 'personal', 'household']).default('all'),
});
export function taskFeeds(route: DataRoute) {
  for (const view of ['today', 'plan'] as const)
    route('GET', `/api/tasks/${view}`, 200, async (tx, account, request) => {
      const q = parse(
        Query.extend({
          cursor: z.iso.date().optional(),
          days: z.coerce.number().int().min(1).max(31).default(14),
        }),
        request.query,
      );
      if (q.householdId && !account.viewer.memberships.has(q.householdId))
        throw new Failure(404, 'NOT_FOUND');
      const house = q.householdId ?? [...account.viewer.memberships.keys()].sort()[0];
      const zone = house
        ? ((
            await tx.execute<{ time_zone: string | null }>(
              sql`SELECT time_zone FROM spaces WHERE id=${house}::uuid`,
            )
          ).rows[0]?.time_zone ?? 'UTC')
        : 'UTC';
      TimeZone.parse(zone);
      const now = new Date(),
        today = localDate(now, zone),
        from = q.cursor ?? today,
        to = shiftTaskDate(from, q.days);
      if (view === 'plan' && (from < today || from > shiftTaskDate(today, 3650)))
        throw new Failure(400, 'INVALID_CURSOR');
      const rows = await tx
        .select()
        .from(tasks)
        .where(
          sql`deleted_at IS NULL AND (${q.scope}='all' OR space_kind::text=${q.scope}) AND (${q.householdId ?? null}::uuid IS NULL OR household_id=${q.householdId ?? null}::uuid) AND ${view === 'today' ? sql`((status IN ('open','waiting') AND (is_main OR plan_on<=coalesce((SELECT (${now.toISOString()}::timestamptz AT TIME ZONE coalesce(s.time_zone,'UTC'))::date FROM spaces s WHERE s.id=tasks.household_id),(${now.toISOString()}::timestamptz AT TIME ZONE ${zone})::date) OR due_on<coalesce((SELECT (${now.toISOString()}::timestamptz AT TIME ZONE coalesce(s.time_zone,'UTC'))::date FROM spaces s WHERE s.id=tasks.household_id),(${now.toISOString()}::timestamptz AT TIME ZONE ${zone})::date))) OR (status='done' AND done_at>=(${today}::date::timestamp AT TIME ZONE ${zone})))` : sql`status IN ('open','waiting') AND (repeat_rule IS NULL OR repeat_next_event_id IS NULL) AND (plan_on IS NULL OR (plan_on>=${from}::date AND plan_on<${to}::date))`}`,
        )
        .orderBy(tasks.planOn, tasks.planTime, tasks.id);
      // Один запрос на страницу; связи и объекты читаются той же ролью и под теми же RLS.
      const linked = rows.length
        ? (
            await tx.execute<{ task_id: string; object: unknown }>(sql`
        SELECT input.id AS task_id, chosen.object
        FROM unnest(ARRAY[${sql.join(
          rows.map((row) => sql`${row.id}::uuid`),
          sql`, `,
        )}]::uuid[]) input(id)
        LEFT JOIN LATERAL (
          SELECT CASE WHEN o.id IS NOT NULL THEN jsonb_build_object('id', o.id, 'title', o.title) END AS object
          FROM record_links l
          LEFT JOIN objects o ON o.id = CASE WHEN l.left_table='objects' THEN l.left_id ELSE l.right_id END AND o.deleted_at IS NULL
          WHERE l.deleted_at IS NULL AND (
            (l.left_table='tasks' AND l.left_id=input.id AND l.right_table='objects') OR
            (l.right_table='tasks' AND l.right_id=input.id AND l.left_table='objects')
          )
          ORDER BY l.created_at, l.id LIMIT 1
        ) chosen ON true
      `)
          ).rows
        : [];
      const objects = new Map(linked.map((row) => [row.task_id, TaskFeedObject.parse(row.object)]));
      const cards = (await summaries(tx, rows)).map((card) => ({
        ...card,
        object: objects.get(card.id) ?? null,
      }));
      if (view === 'plan')
        return {
          householdId: house ?? null,
          timeZone: zone,
          today,
          from,
          days: Array.from({ length: q.days }, (_, i) => {
            const date = shiftTaskDate(from, i);
            return { date, tasks: cards.filter((t) => t.planOn === date) };
          }),
          undated: cards.filter((t) => t.planOn === null),
          nextCursor: to,
        };
      const radar = await readRadar(tx, '0001-01-01', shiftTaskDate(today, 1));
      return {
        householdId: house ?? null,
        timeZone: zone,
        today,
        main: cards.find((t) => t.isMain && t.assigneeId === account.id) ?? null,
        tasks: cards.filter((t) => ['open', 'waiting'].includes(t.status)),
        completed: cards.filter((t) => t.status === 'done'),
        radar: radar.items.filter(
          (i) =>
            ['now', 'overdue'].includes(i.group ?? '') &&
            (q.householdId === undefined || i.householdId === q.householdId) &&
            (q.scope === 'all' || i.spaceKind === q.scope),
        ),
        recalculating: radar.recalculating,
      };
    });
}
