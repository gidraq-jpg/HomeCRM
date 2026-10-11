import type { Pool, PoolClient } from '@homecrm/db';
import { CalendarDate, calendarInstant, localDate, shiftTaskDate } from '@homecrm/shared';

/** Последнее расписание в местном календаре; после простоя создаётся только оно. */
export function summaryPeriod(now: Date, zone: string, kind: 'morning' | 'weekly') {
  let date = localDate(now, zone);
  const clock = kind === 'morning' ? '08:00' : '19:00';
  if (calendarInstant(date, zone, clock) > now) date = CalendarDate.parse(shiftTaskDate(date, -1));
  if (kind === 'weekly') {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    date = CalendarDate.parse(shiftTaskDate(date, -weekday));
  }
  const end = calendarInstant(date, zone, clock);
  const start = calendarInstant(
    CalendarDate.parse(shiftTaskDate(date, kind === 'weekly' ? -7 : -1)),
    zone,
    clock,
  );
  return { date, start, end };
}

/** Общие служебные условия открытого источника. Ни названия, ни причины здесь не читаются. */
export async function summaryHasContent(client: PoolClient, summaryId: string, now: Date) {
  const row = (
    await client.query<{ present: boolean }>(
      `
    SELECT EXISTS (
      SELECT 1 FROM summaries s JOIN deadlines d ON d.household_id=s.household_id
      JOIN deadline_occurrences o ON o.deadline_id=d.id
      WHERE s.id=$1 AND o.assignee_id=s.account_id AND app.radar_occurrence_open(o.id,$2,s.account_id)
      AND (s.kind='weekly' AND o.date<=($2 AT TIME ZONE o.time_zone)::date+7 OR s.kind='morning' AND (o.starts_at<$2 OR o.date<=($2 AT TIME ZONE o.time_zone)::date))
    ) OR EXISTS (
      SELECT 1 FROM summaries s JOIN tasks t ON t.household_id=s.household_id
      WHERE s.id=$1 AND s.kind='weekly' AND t.assignee_id=s.account_id AND t.deleted_at IS NULL AND t.status='done' AND t.done_at>=s.period_start AND t.done_at<s.period_end AND app.record_notification_visible('tasks',t.id,s.account_id)
    ) OR EXISTS (
      SELECT 1 FROM summaries s JOIN deadlines d ON d.household_id=s.household_id
      JOIN documents doc ON doc.id=d.document_id
      WHERE s.id=$1 AND s.kind='weekly' AND doc.assignee_id=s.account_id AND doc.deleted_at IS NULL
      AND doc.status='invalid' AND doc.updated_at>=s.period_start AND doc.updated_at<s.period_end
      AND app.record_notification_visible('documents',doc.id,s.account_id)
    ) OR EXISTS (
      SELECT 1 FROM summaries s JOIN deadlines d ON d.household_id=s.household_id
      JOIN utility_charges c ON c.id=d.charge_id JOIN utility_payments p ON p.parent_id=c.id
      WHERE s.id=$1 AND s.kind='weekly' AND c.assignee_id=s.account_id AND c.deleted_at IS NULL
      AND c.cancelled_at IS NULL AND c.is_paid AND p.deleted_at IS NULL AND p.cancelled_at IS NULL
      AND app.record_notification_visible('objects',d.object_id,s.account_id)
      GROUP BY c.id,s.period_start,s.period_end
      HAVING max(p.created_at)>=s.period_start AND max(p.created_at)<s.period_end
    ) OR EXISTS (
      SELECT 1 FROM summaries s JOIN deadlines d ON d.household_id=s.household_id JOIN radar_actions a ON a.deadline_id=d.id
      WHERE s.id=$1 AND s.kind='weekly' AND d.source_kind='record' AND d.deleted_at IS NULL AND d.assignee_id=s.account_id
      AND a.status='completed' AND a.changed_at>=s.period_start AND a.changed_at<s.period_end AND app.record_notification_visible('deadlines',d.id,s.account_id)
    ) OR EXISTS (
      SELECT 1 FROM deadline_notifications n WHERE n.summary_id=$1 AND app.summary_event_current(n.id,$2)
    ) AS present`,
      [summaryId, now],
    )
  ).rows[0];
  return row?.present === true;
}

export async function scheduleSummaries(pool: Pool, now = new Date()) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(707,2)');
    const members = (
      await client.query<{
        account_id: string;
        space_id: string;
        time_zone: string;
        morning_enabled: boolean;
        weekly_enabled: boolean;
      }>(`
      SELECT m.account_id,m.space_id,s.time_zone,coalesce(n.morning_enabled,true) AS morning_enabled,coalesce(n.weekly_enabled,true) AS weekly_enabled
      FROM space_members m JOIN spaces s ON s.id=m.space_id LEFT JOIN notification_settings n ON n.account_id=m.account_id WHERE m.left_at IS NULL AND s.time_zone IS NOT NULL ORDER BY m.space_id,m.account_id`)
    ).rows;
    for (const member of members)
      for (const kind of ['morning', 'weekly'] as const) {
        if (!(kind === 'morning' ? member.morning_enabled : member.weekly_enabled)) continue;
        const p = summaryPeriod(now, member.time_zone, kind);
        // До первого момента расписания не создаём сводку за время до членства.
        const summary = (
          await client.query<{ id: string }>(
            `
        INSERT INTO summaries(account_id,household_id,time_zone,kind,local_date,period_start,period_end)
        SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS(SELECT 1 FROM space_members WHERE space_id=$2 AND account_id=$1 AND left_at IS NULL AND created_at<=$7)
        ON CONFLICT(account_id,household_id,kind,local_date) DO NOTHING RETURNING id`,
            [member.account_id, member.space_id, member.time_zone, kind, p.date, p.start, p.end],
          )
        ).rows[0];
        if (!summary) continue;
        // Присоединяем логические события, а не строки устройств. Сбой откатывает и связь, и сводку.
        await client.query(
          `UPDATE deadline_notifications n SET summary_id=$1 WHERE recipient_id=$2 AND status='summary' AND summary_id IS NULL AND coalesce(n.event_household_id,(SELECT d.household_id FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE o.id=n.occurrence_id))=$3 AND app.summary_event_current(n.id,$4)`,
          [summary.id, member.account_id, member.space_id, now],
        );
        if (await summaryHasContent(client, summary.id, now))
          await client.query(
            `
        INSERT INTO deadline_notifications(record_table,record_id,event_kind,event_key,event_household_id,recipient_id,warning_at)
        VALUES('summaries',$1,'summary',$2,$3,$4,$5) ON CONFLICT(event_key) DO NOTHING`,
            [summary.id, `summary:${summary.id}`, member.space_id, member.account_id, p.end],
          );
      }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
