// Неизменённый readRadar из f065fc6, только имя экспорта и импорты.
import { type deadlineOccurrencesTable, sql, type Transaction } from '@homecrm/db';
import { type DeadlineRule, localDate, RADAR_GROUPS, radarGroup } from '@homecrm/shared';
import { safeCents } from '../utilities/analytics.ts';

export async function baselineRadar(tx: Transaction, from: string, to: string) {
  // План с вложенным RLS дороже компилировать, чем выполнить на сотнях сроков;
  // источники быстрее соединяются наборами. Обе настройки — одним запросом,
  // только в этой транзакции; замеры проверяют тот же порог 300 мс.
  await tx.execute(
    sql`SELECT set_config('jit','off',true),set_config('enable_nestloop','off',true)`,
  );
  type RadarRow = typeof deadlineOccurrencesTable.$inferSelect & {
    householdId: string;
    documentId: string | null;
    contactId: string | null;
    profileAccountId: string | null;
    birthday: string | null;
    totalCents: string | null;
    paidCents: string | null;
    remainingCents: string | null;
    taskId: string | null;
    noteId: string | null;
    objectId: string | null;
    title: string;
    rule: typeof DeadlineRule._output;
    sourceKind:
      | 'record'
      | 'readings'
      | 'payment'
      | 'verification'
      | 'document'
      | 'birthday'
      | 'task_plan'
      | 'task_due'
      | 'task_waiting';
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
        visible_occurrences AS MATERIALIZED (SELECT * FROM deadline_occurrences WHERE date<=${to} AND date<=CURRENT_DATE+366),
        visible_meters AS MATERIALIZED (SELECT id,title,utility_account_id,is_active,deleted_at FROM meters),
        visible_payments AS MATERIALIZED (SELECT parent_id,sum(amount_cents) AS paid FROM utility_payments WHERE deleted_at IS NULL AND cancelled_at IS NULL GROUP BY parent_id),
        visible_charges AS MATERIALIZED (SELECT c.id,c.parent_id,c.period,c.is_paid,c.deleted_at,c.cancelled_at,c.total_cents,coalesce(p.paid,0) AS paid,greatest(c.total_cents-coalesce(p.paid,0),0) AS remaining FROM utility_charges c LEFT JOIN visible_payments p ON p.parent_id=c.id),
        visible_readings AS MATERIALIZED (SELECT parent_id,occurred_on,transmitted_at,deleted_at FROM meter_readings),
        radar AS (
          SELECT o.id,o.deadline_id AS "deadlineId",o.date,o.starts_at AS "startsAt",o.ends_at AS "endsAt",o.time_zone AS "timeZone",
           o.warnings_at AS "warningsAt",o.completed_at AS "completedAt",o.space_id AS "spaceId",o.space_kind AS "spaceKind",o.audience,
           o.author_id AS "authorId",o.assignee_id AS "assigneeId",o.deleted_at AS "deletedAt",
           d.document_id AS "documentId",d.contact_id AS "contactId",d.profile_account_id AS "profileAccountId",coalesce(bc.data->>'birthday',bp.birth_date::text) AS birthday,
           c.total_cents::text AS "totalCents",c.paid::text AS "paidCents",c.remaining::text AS "remainingCents",
           d.household_id AS "householdId",d.task_id AS "taskId",d.note_id AS "noteId",d.object_id AS "objectId",d.rule,d.source_kind AS "sourceKind",coalesce(d.label,n.title,p.title,doc.title,bc.title,bp.display_name,t.title) AS title,d.charge_id AS "chargeId",
           CASE WHEN p.id IS NOT NULL THEN jsonb_build_object('id',p.id,'title',p.title,'status',p.type_data->>'status') END AS object,
           CASE WHEN a.id IS NOT NULL THEN jsonb_build_object('id',a.id,'title',a.title,'number',a.data->>'number','transmission',a.data->'transmission') END AS "utilityAccount",
           (d.source_kind='readings' AND NOT EXISTS (SELECT 1 FROM visible_meters vm WHERE vm.utility_account_id=d.utility_account_id AND vm.is_active AND vm.deleted_at IS NULL)) AS "needsMeters",
           CASE WHEN m.id IS NOT NULL THEN jsonb_build_object('id',m.id,'title',m.title) END AS meter
          FROM visible_occurrences o JOIN visible_deadlines d ON d.id=o.deadline_id
          LEFT JOIN documents doc ON doc.id=d.document_id LEFT JOIN notes n ON n.id=d.note_id LEFT JOIN objects p ON p.id=d.object_id
          LEFT JOIN tasks t ON t.id=d.task_id
          LEFT JOIN contacts bc ON bc.id=d.contact_id LEFT JOIN member_profiles bp ON bp.account_id=d.profile_account_id
          LEFT JOIN visible_charges c ON c.id=d.charge_id
          LEFT JOIN utility_accounts a ON a.id=d.utility_account_id LEFT JOIN meters m ON m.id=d.meter_id
          WHERE o.date<=${to} AND o.date<=(CURRENT_TIMESTAMP AT TIME ZONE o.time_zone)::date+CASE WHEN d.source_kind IN ('document','birthday') THEN 365 ELSE 90 END AND d.deleted_at IS NULL AND (d.task_id IS NULL OR (t.id IS NOT NULL AND t.deleted_at IS NULL AND t.status IN ('open','waiting'))) AND n.deleted_at IS NULL AND p.deleted_at IS NULL AND doc.deleted_at IS NULL AND (d.document_id IS NULL OR (doc.id IS NOT NULL AND doc.status='valid'))
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
      (['document', 'birthday'].includes(x.sourceKind) &&
      x.warningsAt.some((date) => new Date(date) <= now)
        ? 'later'
        : null)
    );
  };
  const items = rows
    .filter(
      (x) =>
        (x.sourceKind !== 'birthday' || x.endsAt >= now) &&
        (x.completedAt === null || (x.sourceKind === 'readings' && !x.needsMeters)) &&
        (endDate(x) >= from || (x.sourceKind === 'document' && x.endsAt < now)),
    )
    .map((x) => ({
      ...x,
      totalCents: x.totalCents === null ? null : safeCents(x.totalCents),
      paidCents: x.paidCents === null ? null : safeCents(x.paidCents),
      remainingCents: x.remainingCents === null ? null : safeCents(x.remainingCents),
      age:
        x.sourceKind === 'birthday' && x.birthday && !x.birthday.startsWith('--')
          ? Number(x.date.slice(0, 4)) - Number(x.birthday.slice(0, 4))
          : null,
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
      RADAR_GROUPS.map((group) => [group, items.filter((x) => x.group === group).length]),
    ),
  };
}
