import {
  and,
  type Database,
  deadlines,
  eq,
  isNull,
  notes,
  deadlineNotifications as notifications,
  objects,
  deadlineOccurrencesTable as occurrences,
  spaces,
  sql,
} from '@homecrm/db';
import {
  CalendarDate,
  calendarInstant,
  DeadlineRule,
  deadlineOccurrences,
  shiftLocalDays,
  TimeZone,
} from '@homecrm/shared';

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
  await db.delete(deadlines).where(sql`deleted_at < now() - interval '30 days'`);
  const rules = await db
    .select({ id: deadlines.id })
    .from(deadlines)
    .where(full ? undefined : eq(deadlines.needsRefresh, true));
  for (const { id } of rules)
    await db.transaction(async (tx) => {
      const [deadline] = await tx
        .select({
          id: deadlines.id,
          noteId: deadlines.noteId,
          objectId: deadlines.objectId,
          householdId: deadlines.householdId,
          rule: deadlines.rule,
          spaceId: deadlines.spaceId,
          spaceKind: deadlines.spaceKind,
          audience: deadlines.audience,
          authorId: deadlines.authorId,
          assigneeId: deadlines.assigneeId,
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
      const sourceTable = deadline.noteId ? notes : objects;
      const [source] = await tx
        .select({ assigneeId: sourceTable.assigneeId, deletedAt: sourceTable.deletedAt })
        .from(sourceTable)
        .where(eq(sourceTable.id, deadline.noteId ?? deadline.objectId ?? ''));
      const active = deadline.deletedAt === null && source?.deletedAt === null;
      if (!active) {
        if (deadline.needsRefresh)
          await tx.update(deadlines).set({ needsRefresh: false }).where(eq(deadlines.id, id));
        return;
      }
      const baseline = shiftLocalDays(now, -90, zone);
      const calculated = deadlineOccurrences(rule, baseline, zone, 180, true);
      const previous = await tx.select().from(occurrences).where(eq(occurrences.deadlineId, id));
      const currentDates = new Set<string>(calculated.map((x) => x.date));
      for (const old of previous) {
        // Старые невыполненные повторы остаются в радаре и после смены пояса дома.
        if (
          !currentDates.has(old.date) &&
          !deadline.needsRefresh &&
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
          (deadline.needsRefresh || old.startsAt >= baseline)
        )
          await tx.delete(occurrences).where(eq(occurrences.id, old.id));
      }
      for (const item of calculated) {
        const values = {
          deadlineId: id,
          date: item.date,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          timeZone: zone,
          warningsAt: item.warningsAt.map((x) => x.toISOString()),
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
    await tx.execute(sql`UPDATE deadline_notifications n SET status='cancelled'
      FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id
      WHERE n.occurrence_id=o.id AND n.status='pending' AND
      (d.deleted_at IS NOT NULL OR d.needs_refresh OR o.deleted_at IS NOT NULL OR o.completed_at IS NOT NULL OR
       n.recipient_id<>o.assignee_id OR NOT (o.warnings_at ? to_char(n.warning_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))`);
    const rows = await tx
      .select()
      .from(occurrences)
      .where(and(isNull(occurrences.deletedAt), isNull(occurrences.completedAt)));
    for (const row of rows) {
      const [rule] = await tx
        .select({
          noteId: deadlines.noteId,
          objectId: deadlines.objectId,
          deletedAt: deadlines.deletedAt,
          dirty: deadlines.needsRefresh,
        })
        .from(deadlines)
        .where(eq(deadlines.id, row.deadlineId));
      if (!rule || rule.deletedAt !== null || rule.dirty) continue;
      const sourceTable = rule.noteId ? notes : objects;
      const [source] = await tx
        .select({ assigneeId: sourceTable.assigneeId, deletedAt: sourceTable.deletedAt })
        .from(sourceTable)
        .where(eq(sourceTable.id, rule.noteId ?? rule.objectId ?? ''));
      if (!source?.assigneeId || source.deletedAt !== null) continue;
      const recipient = source.assigneeId;
      const visible =
        row.spaceKind === 'personal'
          ? recipient === row.assigneeId
          : (
              await tx.execute(
                sql`SELECT 1 FROM space_members WHERE space_id=${row.spaceId} AND account_id=${recipient} AND left_at IS NULL AND (${row.audience}='household' OR role IN ('admin','adult'))`,
              )
            ).rowCount === 1;
      if (!visible) {
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
      if (row.endsAt < now) continue;
      for (const warning of row.warningsAt)
        if (new Date(warning) <= now)
          await tx
            .insert(notifications)
            .values({ occurrenceId: row.id, recipientId: recipient, warningAt: new Date(warning) })
            .onConflictDoUpdate({
              target: [
                notifications.occurrenceId,
                notifications.recipientId,
                notifications.warningAt,
              ],
              set: { status: 'pending' },
              setWhere: eq(notifications.status, 'cancelled'),
            });
    }
  });
}
