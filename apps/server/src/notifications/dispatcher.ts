import { documentChildBarrierSql, type Pool, type PoolClient } from '@homecrm/db';
import { DeadlineRule, localDate, NotificationSettings } from '@homecrm/shared';
import { warningKinds } from '../deadlines/warnings.ts';
import { budgetDate, DEFAULT_SETTINGS, quietUntil, retryAt } from './policy.ts';
import { type PushSender, pushErrorCode } from './transport.ts';

interface Due {
  id: string;
  notification_id: string;
  account_id: string;
  device_id: string;
  attempts: number;
}
/** Читает только актуальные служебные поля источника; названия worker не получает. */
async function currentSource(client: PoolClient, notificationId: string, now: Date) {
  const { rows } = await client.query<{
    recipient_id: string;
    warning_at: Date;
    time_zone: string;
    record_id: string;
    source_type: 'note' | 'object' | 'document' | 'contact' | 'profile';
    source_kind: 'record' | 'readings' | 'payment' | 'verification' | 'document' | 'birthday';
    contact_id: string | null;
    profile_account_id: string | null;
    starts_at: Date;
    ends_at: Date;
    date: string;
    rule: DeadlineRule;
    notification_kind: NotificationSettings['enabledKinds'][number];
    has_meters: boolean;
  }>(
    `SELECT n.recipient_id,n.warning_at,n.notification_kind,d.rule,o.date::text,
      EXISTS (SELECT 1 FROM meters m WHERE m.utility_account_id=d.utility_account_id AND m.deleted_at IS NULL AND m.is_active) AS has_meters,s.time_zone,coalesce(d.note_id,d.object_id,d.document_id,d.contact_id,d.profile_account_id) AS record_id,d.source_kind,o.starts_at,o.ends_at,d.contact_id,d.profile_account_id,
      CASE WHEN d.note_id IS NOT NULL THEN 'note' WHEN d.document_id IS NOT NULL THEN 'document' WHEN d.contact_id IS NOT NULL THEN 'contact' WHEN d.profile_account_id IS NOT NULL THEN 'profile' ELSE 'object' END AS source_type
    FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id
    JOIN deadlines d ON d.id=o.deadline_id JOIN spaces s ON s.id=d.household_id
    JOIN space_members m ON m.space_id=d.household_id AND m.account_id=n.recipient_id AND m.left_at IS NULL
    WHERE n.id=$1 AND n.status='pending' AND d.deleted_at IS NULL AND NOT d.needs_refresh
      AND o.deleted_at IS NULL AND (o.completed_at IS NULL OR d.source_kind='readings') AND o.time_zone=s.time_zone
      AND o.warnings_at ? to_char(n.warning_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      AND (d.source_kind<>'payment' OR app.utility_payment_open(d.utility_account_id,d.charge_id,o.date))
      AND (d.source_kind<>'readings' OR app.utility_window_open(d.utility_account_id,o.starts_at,o.ends_at,o.time_zone))
    `,
    [notificationId],
  );
  const row = rows[0];
  if (!row) return null;
  // Читаем текущий источник: поля наступления могли устареть после переноса или смены аудитории.
  const sourceTable =
    row.source_type === 'note' ? 'notes' : row.source_type === 'document' ? 'documents' : 'objects';
  const { rows: sources } =
    row.source_kind === 'birthday'
      ? { rows: [] }
      : await client.query<{
          space_kind: string;
          audience: string | null;
          assignee_id: string;
          space_id: string;
        }>(
          `
    SELECT space_kind,audience,assignee_id,space_id FROM ${sourceTable} WHERE id=$1 AND deleted_at IS NULL`,
          [row.record_id],
        );
  const source = sources[0];
  if (row.source_kind === 'birthday') {
    const allowed = await client.query<{ visible: boolean }>(
      'SELECT app.birthday_delivery_name($1,$2,$3) IS NOT NULL AS visible',
      [row.contact_id, row.profile_account_id, row.recipient_id],
    );
    if (!allowed.rows[0]?.visible || row.ends_at < now) return null;
  } else if (!source || source.assignee_id !== row.recipient_id) return null;
  if (
    row.source_type === 'document' &&
    (
      await client.query(
        `SELECT 1 FROM documents WHERE id=$1 AND (${documentChildBarrierSql('$2')})`,
        [row.record_id, row.recipient_id],
      )
    ).rowCount
  )
    return null;
  if (source?.space_kind === 'household') {
    const visible = await client.query(
      `SELECT 1 FROM space_members WHERE space_id=$1 AND account_id=$2
      AND left_at IS NULL AND ($3='household' OR role IN ('admin','adult'))`,
      [source.space_id, row.recipient_id, source.audience],
    );
    if (!visible.rowCount) return null;
  }
  const date = localDate(row.warning_at, row.time_zone);
  if (row.source_kind === 'readings' && !row.has_meters && row.ends_at < now) return null;
  const notificationKind = row.notification_kind;
  const kinds = warningKinds(
    DeadlineRule.parse(row.rule),
    {
      date: row.date,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timeZone: row.time_zone,
    },
    row.source_kind,
  );
  if (!kinds.get(row.warning_at.toISOString())?.includes(notificationKind)) return null;
  const untilStart =
    (Date.parse(localDate(row.starts_at, row.time_zone)) - Date.parse(date)) / 86_400_000;
  const untilEnd =
    (Date.parse(localDate(row.ends_at, row.time_zone)) - Date.parse(date)) / 86_400_000;
  return { ...row, notificationKind, untilStart, untilEnd };
}

async function transaction<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/** Один диспетчер на базу. Вызов и результат разделены устойчивым состоянием sending (ADR-0029). */
export async function dispatchNotifications(pool: Pool, send: PushSender, now = new Date()) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked =
      (await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(707,1) AS locked'))
        .rows[0]?.locked === true;
    if (!locked) return;
    await client.query("DELETE FROM push_attempts WHERE attempted_at < now() - interval '90 days'");
    // Неизвестный результат после аварии не повторяем вслепую: оставляем в журнале и сводке.
    await transaction(client, async () => {
      const stale = await client.query<Due>(
        `UPDATE push_deliveries SET status='summary' WHERE status='sending'
        AND reserved_at < $1::timestamptz - interval '10 minutes' RETURNING *`,
        [now],
      );
      for (const row of stale.rows) await recordAttempt(client, row, now, 'uncertain', null);
    });
    await client.query(
      `INSERT INTO push_deliveries(notification_id,account_id,device_id,next_attempt_at)
      SELECT n.id,n.recipient_id,s.id,$1 FROM deadline_notifications n JOIN push_subscriptions s ON s.account_id=n.recipient_id
      WHERE n.status='pending' AND n.warning_at <= $1 ON CONFLICT (notification_id,device_id) DO NOTHING`,
      [now],
    );
    const due = await client.query<Due>(
      `SELECT * FROM push_deliveries WHERE status='pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at,id`,
      [now],
    );
    for (const delivery of due.rows) {
      const reserved = await transaction(client, async () => {
        const source = await currentSource(client, delivery.notification_id, now);
        if (!source) {
          await finish(client, delivery, 'cancelled');
          return false;
        }
        const raw = (
          await client.query(
            'SELECT quiet_start AS "quietStart",quiet_end AS "quietEnd",daily_budget AS "dailyBudget",enabled_kinds AS "enabledKinds",hide_text AS "hideText" FROM notification_settings WHERE account_id=$1',
            [delivery.account_id],
          )
        ).rows[0];
        const settings = NotificationSettings.parse(raw ?? DEFAULT_SETTINGS);
        if (!settings.enabledKinds.includes(source.notificationKind)) {
          await client.query(
            "UPDATE deadline_notifications SET status='cancelled',cancellation_reason='settings' WHERE id=$1",
            [delivery.notification_id],
          );
          await finish(client, delivery, 'cancelled');
          return false;
        }
        if (+now - +source.warning_at > 86_400_000) {
          await finish(client, delivery, 'summary');
          return false;
        }
        const quiet = quietUntil(now, source.time_zone, settings.quietStart, settings.quietEnd);
        if (quiet) {
          await client.query('UPDATE push_deliveries SET next_attempt_at=$2 WHERE id=$1', [
            delivery.id,
            quiet,
          ]);
          return false;
        }
        const day = budgetDate(now, source.time_zone);
        const used = await client.query<{ used: string; counted: boolean }>(
          `SELECT count(DISTINCT notification_id)::text AS used,
          coalesce(bool_or(notification_id=$2),false) AS counted FROM push_deliveries WHERE account_id=$1 AND budget_date=$3`,
          [delivery.account_id, delivery.notification_id, day],
        );
        const budget = used.rows[0];
        if (!budget?.counted && Number(budget?.used) >= settings.dailyBudget) {
          await finish(client, delivery, 'summary');
          return false;
        }
        await client.query(
          "UPDATE push_deliveries SET status='sending',reserved_at=$2,budget_date=$3,attempts=attempts+1 WHERE id=$1",
          [delivery.id, now, day],
        );
        return true;
      });
      if (!reserved) continue;
      await transaction(client, async () => {
        // Перепроверка перед сетевым вызовом; отзыв подписки ждёт завершения вызова.
        const source = await currentSource(client, delivery.notification_id, now);
        const device = (
          await client.query(
            'SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE id=$1 AND account_id=$2 FOR SHARE',
            [delivery.device_id, delivery.account_id],
          )
        ).rows[0];
        if (!source || !device) {
          await finish(client, delivery, 'cancelled');
          return;
        }
        const settings = (
          await client.query<{ hide_text: boolean }>(
            'SELECT hide_text FROM notification_settings WHERE account_id=$1',
            [delivery.account_id],
          )
        ).rows[0];
        const birthdayName =
          source.source_kind === 'birthday' && settings?.hide_text === false
            ? (
                await client.query<{ name: string | null }>(
                  'SELECT app.birthday_delivery_name($1,$2,$3) AS name',
                  [source.contact_id, source.profile_account_id, source.recipient_id],
                )
              ).rows[0]?.name
            : null;
        try {
          await send(
            device,
            {
              kind: 'deadline',
              ...(source.source_kind === 'record' || source.source_kind === 'document'
                ? {}
                : { notificationKind: source.notificationKind }),
              recordId: source.record_id,
              text:
                (settings?.hide_text ?? true)
                  ? 'В HomeCRM есть новое'
                  : source.source_kind === 'birthday'
                    ? `День рождения: ${birthdayName ?? 'участник'}`
                    : {
                        deadline: 'Подходит срок записи в HomeCRM',
                        readings_open:
                          source.untilStart > 0
                            ? 'Скоро откроется окно показаний'
                            : 'Открылось окно показаний',
                        readings_closing:
                          source.untilEnd === 1
                            ? 'Окно закрывается завтра'
                            : 'Подходит конец окна показаний',
                        readings_last_day: 'Последний день передачи показаний',
                        payment_upcoming:
                          source.untilStart === 3 ? 'Оплата через 3 дня' : 'Подходит срок оплаты',
                        payment_due: 'Оплата сегодня',
                        verification: 'Подходит срок поверки',
                      }[source.notificationKind] +
                      (source.source_kind === 'readings' && !source.has_meters
                        ? '. Добавьте счётчики'
                        : ''),
            },
            delivery.id,
          );
        } catch (error) {
          const code = pushErrorCode(error);
          await recordAttempt(
            client,
            delivery,
            now,
            code === 404 || code === 410 ? 'gone' : 'retry',
            code,
          );
          if (code === 404 || code === 410) {
            await client.query('DELETE FROM push_subscriptions WHERE id=$1', [delivery.device_id]);
            await finish(client, delivery, 'gone');
          } else
            await client.query(
              "UPDATE push_deliveries SET status='pending',next_attempt_at=$2 WHERE id=$1",
              [delivery.id, retryAt(now, delivery.attempts + 1)],
            );
          return;
        }
        await finish(client, delivery, 'sent');
        await recordAttempt(client, delivery, now, 'sent', null);
        await client.query('UPDATE push_subscriptions SET last_success_at=$2 WHERE id=$1', [
          delivery.device_id,
          now,
        ]);
      });
    }
    await client.query(`UPDATE deadline_notifications n SET status=CASE WHEN EXISTS
      (SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id AND d.status='summary') THEN 'summary'
      WHEN EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id AND d.status='sent') THEN 'sent' ELSE 'cancelled' END
      WHERE n.status='pending' AND EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id)
      AND NOT EXISTS (SELECT 1 FROM push_deliveries d WHERE d.notification_id=n.id AND d.status IN ('pending','sending'))`);
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(707,1)');
    } finally {
      client.release();
    }
  }
}
async function finish(client: PoolClient, row: Due, status: string) {
  await client.query('UPDATE push_deliveries SET status=$2 WHERE id=$1', [row.id, status]);
}
async function recordAttempt(
  client: PoolClient,
  row: Due,
  now: Date,
  result: string,
  code: number | null,
) {
  await client.query(
    'INSERT INTO push_attempts(account_id,device_id,attempted_at,result,error_code) VALUES($1,$2,$3,$4,$5)',
    [row.account_id, row.device_id, now, result, code],
  );
}
