import { sql } from '@homecrm/db';
import {
  BillingPeriod,
  canView,
  DeadlineRule,
  deadlineOccurrences,
  localDate,
} from '@homecrm/shared';
import { z } from 'zod';
import { getObject } from '../objects/routes.ts';
import { type DataRoute, Failure, parse, placementOf } from '../objects/support.ts';

export function safeCents(value: string | bigint): number {
  const cents = BigInt(value);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < BigInt(Number.MIN_SAFE_INTEGER))
    throw new Failure(409, 'TOTAL_TOO_LARGE');
  return Number(cents);
}
type Money = { charged: string; paid: string; remaining: string };
const money = (r: Money) => ({
  chargedCents: safeCents(r.charged),
  paidCents: safeCents(r.paid),
  remainingCents: safeCents(r.remaining),
});

export function analyticsRoutes(route: DataRoute) {
  route('GET', '/api/utilities/month', 200, async (tx, account, request) => {
    const { month } = parse(z.strictObject({ month: BillingPeriod }), request.query);
    // Вложенные политики RLS делают JIT дороже самого месячного агрегирования.
    await tx.execute(sql`SET LOCAL jit=off`);
    type AccountStatus = {
      id: string;
      title: string;
      data: { transmission?: { method: string }; readingRule?: unknown };
      zone: string;
      transmittedReadings: { meterId: string; date: string }[];
      meterIds: string[];
      completed: boolean;
    };
    type MonthRow = Money & {
      id: string;
      title: string;
      spaceId: string;
      spaceKind: 'personal' | 'household';
      audience: 'adults' | 'household' | null;
      assigneeId: string;
      accounts: AccountStatus[];
    };
    const { rows } = await tx.execute<MonthRow>(sql`
      WITH visible_objects AS MATERIALIZED (SELECT * FROM objects WHERE deleted_at IS NULL),
      accounts AS MATERIALIZED (SELECT a.*,coalesce(s.time_zone,hs.time_zone,'UTC') AS zone FROM utility_accounts a
        JOIN visible_objects p ON p.id=a.parent_id JOIN spaces s ON s.id=p.space_id
        LEFT JOIN LATERAL (SELECT h.time_zone FROM space_members m JOIN spaces h ON h.id=m.space_id WHERE m.account_id=p.assignee_id AND m.left_at IS NULL ORDER BY h.id LIMIT 1) hs ON true
        WHERE a.deleted_at IS NULL),
      payments AS MATERIALIZED (SELECT parent_id,sum(amount_cents) AS paid FROM utility_payments WHERE deleted_at IS NULL AND cancelled_at IS NULL GROUP BY parent_id),
      charges AS MATERIALIZED (SELECT a.parent_id,sum(c.total_cents) AS charged,sum(coalesce(p.paid,0)) AS paid,
        sum(greatest(c.total_cents-coalesce(p.paid,0),0)) AS remaining
        FROM utility_charges c JOIN accounts a ON a.id=c.parent_id LEFT JOIN payments p ON p.parent_id=c.id
        WHERE c.period=${month} AND c.deleted_at IS NULL AND c.cancelled_at IS NULL GROUP BY a.parent_id),
      meters AS MATERIALIZED (SELECT m.id,m.utility_account_id FROM meters m WHERE m.deleted_at IS NULL AND m.is_active),
      readings AS MATERIALIZED (SELECT r.parent_id,r.occurred_on::text AS date FROM meter_readings r WHERE r.deleted_at IS NULL AND r.transmitted_at IS NOT NULL
        AND r.occurred_on>=(${month}||'-01')::date AND r.occurred_on<(${month}||'-01')::date+interval '2 months'),
      visible_deadlines AS MATERIALIZED (SELECT id,utility_account_id FROM deadlines WHERE source_kind='readings' AND deleted_at IS NULL),
      completed_accounts AS MATERIALIZED (SELECT DISTINCT d.utility_account_id FROM deadline_occurrences o JOIN visible_deadlines d ON d.id=o.deadline_id WHERE o.date>=(${month}||'-01')::date AND o.date<(${month}||'-01')::date+interval '1 month' AND o.deleted_at IS NULL AND o.completed_at IS NOT NULL),
      statuses AS MATERIALIZED (SELECT a.parent_id,jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'data',a.data,'zone',a.zone,
        'meterIds',coalesce((SELECT jsonb_agg(m.id) FROM meters m WHERE m.utility_account_id=a.id),'[]'::jsonb),
        'transmittedReadings',coalesce((SELECT jsonb_agg(jsonb_build_object('date',r.date,'meterId',r.parent_id)) FROM readings r JOIN meters m ON m.id=r.parent_id WHERE m.utility_account_id=a.id),'[]'::jsonb),
        'completed',EXISTS(SELECT 1 FROM completed_accounts c WHERE c.utility_account_id=a.id)) ORDER BY a.id) AS accounts
        FROM accounts a GROUP BY a.parent_id)
      SELECT o.id,o.title,o.space_id AS "spaceId",o.space_kind AS "spaceKind",o.audience,o.assignee_id AS "assigneeId",
        coalesce(c.charged,0)::text AS charged,coalesce(c.paid,0)::text AS paid,coalesce(c.remaining,0)::text AS remaining,coalesce(s.accounts,'[]'::jsonb) AS accounts
      FROM visible_objects o LEFT JOIN charges c ON c.parent_id=o.id LEFT JOIN statuses s ON s.parent_id=o.id ORDER BY o.title,o.id`);
    const now = new Date();
    const windowsByRule = new Map<
      string,
      { startsAt: Date; endsAt: Date; startDate: string; endDate: string } | null
    >();
    const windowFor = (a: AccountStatus) => {
      const key = `${a.zone}:${JSON.stringify(a.data.readingRule ?? null)}`;
      if (!windowsByRule.has(key)) {
        const rule = a.data.readingRule ? DeadlineRule.parse(a.data.readingRule) : null;
        const window = rule
          ? deadlineOccurrences(rule, new Date(`${month}-01T00:00:00Z`), a.zone, 62, true).find(
              (o) => o.date.startsWith(month),
            )
          : undefined;
        windowsByRule.set(
          key,
          window
            ? {
                ...window,
                startDate: localDate(window.startsAt, a.zone),
                endDate: localDate(window.endsAt, a.zone),
              }
            : null,
        );
      }
      return windowsByRule.get(key) ?? null;
    };
    const visible = rows.filter((r) => canView(account.viewer, placementOf(r)));
    const objects = visible.map((r) => ({
      id: r.id,
      title: r.title,
      ...money(r),
      accounts: r.accounts.map((a) => {
        const method = a.data.transmission?.method;
        const window = windowFor(a);
        const transmitted =
          window &&
          (a.meterIds.length > 0
            ? a.meterIds.every((id) =>
                a.transmittedReadings.some(
                  (r) => r.meterId === id && r.date >= window.startDate && r.date <= window.endDate,
                ),
              )
            : a.completed);
        const status =
          method === 'not_required' || method === 'automatic' || !window
            ? 'not_required'
            : now < window.startsAt
              ? 'not_open'
              : transmitted
                ? 'transmitted'
                : 'not_transmitted';
        return { id: a.id, title: a.title, status };
      }),
    }));
    return {
      month,
      objects,
      totals: money(
        visible.reduce<Money>(
          (s, r) => ({
            charged: (BigInt(s.charged) + BigInt(r.charged)).toString(),
            paid: (BigInt(s.paid) + BigInt(r.paid)).toString(),
            remaining: (BigInt(s.remaining) + BigInt(r.remaining)).toString(),
          }),
          { charged: '0', paid: '0', remaining: '0' },
        ),
      ),
    };
  });
  route('GET', '/api/objects/:id/analytics', 200, async (tx, account, request) => {
    const { id } = parse(z.strictObject({ id: z.uuid() }), request.params);
    const parent = await getObject(tx, account, id);
    const { month } = parse(z.strictObject({ month: BillingPeriod.optional() }), request.query);
    await tx.execute(sql`SET LOCAL jit=off`);
    const result = await tx.execute<{
      month: string;
      charged: string;
      paid: string;
      consumption: { resource: string; unit: string; value: string }[];
    }>(sql`
      WITH anchor AS (SELECT (${month ?? null}::text||'-01')::date AS explicit),
      bounds AS (SELECT coalesce(explicit,date_trunc('month',now() AT TIME ZONE coalesce(s.time_zone,h.time_zone,'UTC'))::date) AS ending FROM anchor CROSS JOIN spaces s
        LEFT JOIN LATERAL (SELECT hs.time_zone FROM space_members m JOIN spaces hs ON hs.id=m.space_id WHERE m.account_id=${parent.assigneeId}::uuid AND m.left_at IS NULL ORDER BY hs.id LIMIT 1) h ON true WHERE s.id=${parent.spaceId}::uuid),
      months AS (SELECT generate_series(ending-interval '23 months',ending,interval '1 month')::date AS date FROM bounds),
      accounts AS MATERIALIZED (SELECT id FROM utility_accounts WHERE parent_id=${id}::uuid AND deleted_at IS NULL),
      charges AS MATERIALIZED (SELECT c.* FROM utility_charges c JOIN accounts a ON a.id=c.parent_id WHERE c.deleted_at IS NULL AND c.cancelled_at IS NULL),
      amounts AS (SELECT period,sum(total_cents) AS amount FROM charges GROUP BY period),
      paid AS (SELECT to_char(p.paid_on,'YYYY-MM') AS period,sum(p.amount_cents) AS amount FROM utility_payments p JOIN charges c ON c.id=p.parent_id WHERE p.deleted_at IS NULL AND p.cancelled_at IS NULL GROUP BY 1),
      consumption AS (SELECT to_char(r.occurred_on,'YYYY-MM') AS period,m.data->>'resource' AS resource,m.data->>'unit' AS unit,sum(v.value)::text AS value
        FROM meter_readings r JOIN meters m ON m.id=r.parent_id CROSS JOIN LATERAL unnest(r.consumption) v(value)
        WHERE m.parent_id=${id}::uuid AND m.deleted_at IS NULL AND r.deleted_at IS NULL AND r.consumption IS NOT NULL
        GROUP BY 1,2,3)
      SELECT to_char(m.date,'YYYY-MM') AS month,coalesce(c.amount,0)::text AS charged,coalesce(p.amount,0)::text AS paid,
       coalesce((SELECT jsonb_agg(jsonb_build_object('resource',r.resource,'unit',r.unit,'value',r.value) ORDER BY r.resource,r.unit) FROM consumption r WHERE r.period=to_char(m.date,'YYYY-MM')),'[]'::jsonb) AS consumption
      FROM months m LEFT JOIN amounts c ON c.period=to_char(m.date,'YYYY-MM') LEFT JOIN paid p ON p.period=to_char(m.date,'YYYY-MM') ORDER BY m.date`);
    const values = result.rows.map((r) => ({
      month: r.month,
      chargedCents: safeCents(r.charged),
      paidCents: safeCents(r.paid),
      consumption: r.consumption,
    }));
    return {
      objectId: id,
      months: values.slice(12).map((r, i) => ({ ...r, previousYear: values[i] })),
    };
  });
}
