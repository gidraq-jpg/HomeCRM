import { sql, tasks } from '@homecrm/db';
import { localDate, shiftTaskDate } from '@homecrm/shared';
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
      const today = localDate(new Date(), zone),
        from = q.cursor ?? today,
        to = shiftTaskDate(from, q.days);
      if (view === 'plan' && (from < today || from > shiftTaskDate(today, 3650)))
        throw new Failure(400, 'INVALID_CURSOR');
      const rows = await tx
        .select()
        .from(tasks)
        .where(
          sql`deleted_at IS NULL AND (${q.scope}='all' OR space_kind::text=${q.scope}) AND (${q.householdId ?? null}::uuid IS NULL OR household_id=${q.householdId ?? null}::uuid) AND ${view === 'today' ? sql`((status IN ('open','waiting') AND (is_main OR plan_on<=coalesce((SELECT (CURRENT_TIMESTAMP AT TIME ZONE coalesce(s.time_zone,'UTC'))::date FROM spaces s WHERE s.id=tasks.household_id),CURRENT_DATE))) OR (status='done' AND done_at>=(${today}::date::timestamp AT TIME ZONE ${zone})))` : sql`status IN ('open','waiting') AND (plan_on IS NULL OR (plan_on>=${from}::date AND plan_on<${to}::date))`}`,
        )
        .orderBy(tasks.planOn, tasks.planTime, tasks.id);
      const cards = await summaries(tx, rows);
      if (view === 'plan')
        return {
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
