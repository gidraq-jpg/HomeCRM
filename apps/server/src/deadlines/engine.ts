import {
  and,
  type Database,
  deadlines,
  documentChildBarrierSql,
  documents,
  eq,
  isNull,
  notes,
  objects,
  deadlineOccurrencesTable as occurrences,
  spaces,
  sql,
  tasks,
} from '@homecrm/db';
import {
  CalendarDate,
  calendarInstant,
  DeadlineRule,
  deadlineOccurrences,
  shiftLocalDays,
  TimeZone,
} from '@homecrm/shared';
import { warningKinds } from './warnings.ts';

/** Заполняет только ещё не выбранный пояс; дальнейшая настройка сервера дом не меняет. */
export async function initializeHouseTimeZones(db: Database, fallback: string) {
  TimeZone.parse(fallback);
  await db
    .update(spaces)
    .set({ timeZone: fallback })
    .where(and(eq(spaces.kind, 'household'), isNull(spaces.timeZone)));
}
/** Повторный запуск сохраняет UUID наступлений, выполненные пункты и ключи отправленных уведомлений. */
export async function refreshDeadlines(db: Database, now = new Date(), full = false) {
  // RLS разрешает DELETE только после 30 дней корзины; потомки уходят по FK.
  await db
    .delete(deadlines)
    .where(sql`source_kind='record' AND deleted_at < now() - interval '30 days'`);
  const rules = await db
    .select({ id: deadlines.id })
    .from(deadlines)
    .where(full ? undefined : eq(deadlines.needsRefresh, true));
  for (const { id } of rules)
    await db.transaction(async (tx) => {
      const [deadline] = await tx
        .select({
          id: deadlines.id,
          createdAt: deadlines.createdAt,
          chargeId: deadlines.chargeId,
          documentId: deadlines.documentId,
          contactId: deadlines.contactId,
          profileAccountId: deadlines.profileAccountId,
          taskId: deadlines.taskId,
          noteId: deadlines.noteId,
          objectId: deadlines.objectId,
          sourceKind: deadlines.sourceKind,
          householdId: deadlines.householdId,
          rule: deadlines.rule,
          spaceId: deadlines.spaceId,
          spaceKind: deadlines.spaceKind,
          audience: deadlines.audience,
          authorId: deadlines.authorId,
          assigneeId: deadlines.assigneeId,
          assigneeOverrideId: deadlines.assigneeOverrideId,
          deletedAt: deadlines.deletedAt,
          needsRefresh: deadlines.needsRefresh,
        })
        .from(deadlines)
        .where(eq(deadlines.id, id))
        .for('update');
      if (!deadline) return;
      const [house] = await tx
        .select({ timeZone: spaces.timeZone })
        .from(spaces)
        .where(eq(spaces.id, deadline.householdId));
      if (!house?.timeZone) throw new Error('House time zone is not initialized');
      const zone = TimeZone.parse(house.timeZone);
      const rule = DeadlineRule.parse(deadline.rule);
      const sourceTable = deadline.taskId
        ? tasks
        : deadline.noteId
          ? notes
          : deadline.documentId
            ? documents
            : objects;
      const [recordSource] =
        deadline.sourceKind === 'birthday'
          ? []
          : await tx
              .select({ assigneeId: sourceTable.assigneeId, deletedAt: sourceTable.deletedAt })
              .from(sourceTable)
              .where(
                eq(
                  sourceTable.id,
                  deadline.taskId ??
                    deadline.noteId ??
                    deadline.objectId ??
                    deadline.documentId ??
                    '',
                ),
              );
      const source =
        deadline.sourceKind === 'birthday'
          ? { assigneeId: deadline.assigneeId, deletedAt: deadline.deletedAt }
          : recordSource;
      if (source && deadline.assigneeOverrideId) source.assigneeId = deadline.assigneeOverrideId;
      const active = deadline.deletedAt === null && source?.deletedAt === null;
      if (!active) {
        if (deadline.needsRefresh)
          await tx.update(deadlines).set({ needsRefresh: false }).where(eq(deadlines.id, id));
        return;
      }
      const utility =
        !['record', 'document', 'birthday', 'task_plan', 'task_due', 'task_waiting'].includes(
          deadline.sourceKind,
        ) && deadline.chargeId === null;
      const baseline = utility
        ? deadline.createdAt
        : ['document', 'birthday'].includes(deadline.sourceKind)
          ? now
          : shiftLocalDays(now, -90, zone);
      const horizon = shiftLocalDays(now, 90, zone);
      const byDate = new Map<string, ReturnType<typeof deadlineOccurrences>[number]>();
      // Коммунальные повторы начинаются у источника, а не за 90 дней до запуска.
      // Части ограничены календарным лимитом общего движка; старые реальные долги сохраняются.
      for (let cursor = baseline; cursor <= horizon; cursor = shiftLocalDays(cursor, 181, zone)) {
        for (const item of deadlineOccurrences(
          rule,
          cursor,
          zone,
          ['document', 'birthday'].includes(deadline.sourceKind) ? 365 : 180,
          true,
        )) {
          if (!utility || (item.endsAt >= baseline && item.startsAt <= horizon))
            byDate.set(item.date, item);
        }
        if (!utility) break;
      }
      const calculated = [...byDate.values()];
      const previous = await tx.select().from(occurrences).where(eq(occurrences.deadlineId, id));
      const currentDates = new Set<string>(calculated.map((x) => x.date));
      for (const old of previous) {
        // Старые невыполненные повторы остаются в радаре и после смены пояса дома.
        if (
          !currentDates.has(old.date) &&
          !deadline.needsRefresh &&
          (deadline.sourceKind === 'record' || old.endsAt >= deadline.createdAt) &&
          old.startsAt < baseline &&
          old.timeZone !== zone
        ) {
          const revised = deadlineOccurrences(
            rule,
            calendarInstant(CalendarDate.parse(old.date), zone),
            zone,
            0,
          ).find((x) => x.date === old.date);
          if (revised) calculated.push(revised);
        }
        if (
          !currentDates.has(old.date) &&
          old.completedAt === null &&
          (deadline.needsRefresh || old.startsAt >= baseline || (utility && old.endsAt < baseline))
        )
          await tx.delete(occurrences).where(eq(occurrences.id, old.id));
      }
      for (const item of calculated) {
        const old = previous.find((row) => row.date === item.date);
        const values = {
          deadlineId: id,
          date: item.date,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          timeZone: zone,
          // Новое предупреждение не досылает прошлое; уже рассчитанное переживает простой.
          warningsAt: item.warningsAt
            .filter((x) => !utility || x >= deadline.createdAt)
            .filter((x) => !old || x >= now || old.warningsAt.includes(x.toISOString()))
            .map((x) => x.toISOString()),
          spaceId: deadline.spaceId,
          spaceKind: deadline.spaceKind,
          audience: deadline.audience,
          authorId: deadline.authorId,
          assigneeId: source?.assigneeId ?? deadline.assigneeId,
          deletedAt: deadline.deletedAt,
        };
        await tx
          .insert(occurrences)
          .values(values)
          .onConflictDoUpdate({ target: [occurrences.deadlineId, occurrences.date], set: values });
      }
      if (deadline.needsRefresh)
        await tx.update(deadlines).set({ needsRefresh: false }).where(eq(deadlines.id, id));
    });
}
/** Проверка предупреждений раз в пять минут. Названия и тексты worker не читает. */
export async function enqueueDeadlineWarnings(db: Database, now = new Date()) {
  await db.transaction(async (tx) => {
    // Отменяем утратившие актуальность события даже без подписанного устройства.
    await tx.execute(
      sql`UPDATE deadline_notifications n SET status='cancelled' WHERE n.record_id IS NOT NULL AND n.status='pending' AND NOT app.record_notification_current(n.record_table,n.record_id,n.recipient_id,n.event_kind,n.event_key)`,
    );
    await tx.execute(sql`UPDATE deadline_notifications n SET status='cancelled'
      FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id
      WHERE n.occurrence_id=o.id AND n.status='pending' AND
      (d.deleted_at IS NOT NULL OR d.needs_refresh OR o.deleted_at IS NOT NULL OR (o.completed_at IS NOT NULL AND d.source_kind<>'readings') OR
       n.recipient_id<>o.assignee_id OR NOT (o.warnings_at ? to_char(n.warning_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`);
    await tx.execute(sql`UPDATE deadline_notifications n SET status='cancelled' FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id
      WHERE n.occurrence_id=o.id AND n.status='pending' AND d.source_kind='readings' AND NOT app.utility_window_open(d.utility_account_id,o.starts_at,o.ends_at,o.time_zone)`);
    await tx.execute(
      sql`UPDATE deadline_notifications n SET status='cancelled' FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE n.occurrence_id=o.id AND n.status='pending' AND d.source_kind='payment' AND NOT app.utility_payment_open(d.utility_account_id,d.charge_id,o.date)`,
    );
    const rows = await tx
      .select()
      .from(occurrences)
      .where(
        and(
          isNull(occurrences.deletedAt),
          sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.id=${occurrences.deadlineId} AND (d.source_kind<>'payment' OR app.utility_payment_open(d.utility_account_id,d.charge_id,${occurrences.date})))`,
          sql`(${occurrences.completedAt} IS NULL OR EXISTS (SELECT 1 FROM deadlines d WHERE d.id=${occurrences.deadlineId} AND d.source_kind='readings'))`,
          sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.id=${occurrences.deadlineId} AND (d.source_kind<>'readings' OR app.utility_window_open(d.utility_account_id,${occurrences.startsAt},${occurrences.endsAt},${occurrences.timeZone})))`,
        ),
      );
    for (const row of rows) {
      const [rule] = await tx
        .select({
          documentId: deadlines.documentId,
          contactId: deadlines.contactId,
          profileAccountId: deadlines.profileAccountId,
          taskId: deadlines.taskId,
          noteId: deadlines.noteId,
          objectId: deadlines.objectId,
          deletedAt: deadlines.deletedAt,
          dirty: deadlines.needsRefresh,
          assigneeOverrideId: deadlines.assigneeOverrideId,
          householdId: deadlines.householdId,
          sourceKind: deadlines.sourceKind,
          rule: deadlines.rule,
          utilityAccountId: deadlines.utilityAccountId,
        })
        .from(deadlines)
        .where(eq(deadlines.id, row.deadlineId));
      if (!rule || rule.deletedAt !== null || rule.dirty) continue;
      const sourceTable = rule.taskId
        ? tasks
        : rule.noteId
          ? notes
          : rule.documentId
            ? documents
            : objects;
      const [recordSource] =
        rule.sourceKind === 'birthday'
          ? []
          : await tx
              .select({ assigneeId: sourceTable.assigneeId, deletedAt: sourceTable.deletedAt })
              .from(sourceTable)
              .where(
                eq(
                  sourceTable.id,
                  rule.taskId ?? rule.noteId ?? rule.objectId ?? rule.documentId ?? '',
                ),
              );
      const source =
        rule.sourceKind === 'birthday'
          ? { assigneeId: row.assigneeId, deletedAt: row.deletedAt }
          : recordSource;
      if (source && rule.assigneeOverrideId) source.assigneeId = rule.assigneeOverrideId;
      if (!source?.assigneeId || source.deletedAt !== null) continue;
      const recipient = source.assigneeId;
      const visible =
        row.spaceKind === 'personal'
          ? recipient === row.assigneeId &&
            (
              await tx.execute(
                sql`SELECT 1 FROM space_members WHERE space_id=${rule.householdId} AND account_id=${recipient} AND left_at IS NULL`,
              )
            ).rowCount === 1
          : (
              await tx.execute(
                sql`SELECT 1 FROM space_members WHERE space_id=${row.spaceId} AND account_id=${recipient} AND left_at IS NULL AND (${row.audience}='household' OR role IN ('admin','adult'))`,
              )
            ).rowCount === 1;
      const expiredEmptyWindow =
        rule.sourceKind === 'readings' &&
        row.endsAt < now &&
        (
          await tx.execute(
            sql`SELECT 1 FROM meters WHERE utility_account_id=${rule.utilityAccountId} AND is_active AND deleted_at IS NULL LIMIT 1`,
          )
        ).rowCount === 0;
      const hiddenIdentity =
        rule.documentId !== null &&
        (
          await tx.execute(
            sql`WITH target AS (SELECT ${recipient}::uuid AS account_id) SELECT 1 FROM documents CROSS JOIN target WHERE documents.id=${rule.documentId}::uuid AND (${sql.raw(documentChildBarrierSql('target.account_id'))})`,
          )
        ).rowCount === 1;
      const hiddenBirthday =
        rule.sourceKind === 'birthday' &&
        (
          await tx.execute(
            sql`SELECT app.birthday_delivery_name(${rule.contactId}::uuid,${rule.profileAccountId}::uuid,${recipient}::uuid) IS NOT NULL AS visible`,
          )
        ).rows[0]?.visible !== true;
      if (!visible || expiredEmptyWindow || hiddenIdentity || hiddenBirthday) {
        await tx.execute(
          sql`UPDATE deadline_notifications SET status='cancelled' WHERE occurrence_id=${row.id} AND status='pending'`,
        );
        continue;
      }
      if (row.assigneeId !== recipient)
        await tx
          .update(occurrences)
          .set({ assigneeId: recipient })
          .where(eq(occurrences.id, row.id));
      await tx.execute(
        sql`UPDATE deadline_notifications SET status='cancelled' WHERE occurrence_id=${row.id} AND recipient_id<>${recipient} AND status='pending'`,
      );
      // R0.7 досылает пропущенное после простоя; старше суток диспетчер направляет в сводку.
      const kinds = warningKinds(DeadlineRule.parse(rule.rule), row, rule.sourceKind);
      for (const warning of row.warningsAt)
        if (new Date(warning) <= now)
          for (const kind of kinds.get(warning) ?? [])
            await tx.execute(sql`INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at,notification_kind)
              VALUES(${row.id},${recipient},${new Date(warning)},${kind})
              ON CONFLICT (occurrence_id,recipient_id,warning_at,notification_kind) WHERE status<>'cancelled' OR cancellation_reason IS NOT NULL DO NOTHING`);
    }
  });
}
