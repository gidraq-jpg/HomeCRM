import { randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { CalendarDate, calendarInstant, localDate, shiftTaskDate } from '@homecrm/shared';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import {
  enqueueDeadlineWarnings,
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { dispatchNotifications } from './dispatcher.ts';
import { scheduleSummaries, summaryPeriod } from './summaries.ts';
import type { PushSender } from './transport.ts';

let world: World, adult: Device, admin: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => world?.close());
beforeEach(async () => {
  for (const table of [
    'deadline_notifications',
    'summaries',
    'push_subscriptions',
    'notification_settings',
    'deadlines',
    'tasks',
    'notes',
  ])
    await world.database.admin.query(`DELETE FROM ${table}`);
  await world.clearRateLimits();
});
const runAt = () => new Date(Date.now() + 86400000);
async function source(common = false, device = adult) {
  const n = await device.post('/api/notes', {
    title: 'Вымышленное срочное обязательство',
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(n.status, n.text).toBe(201);
  const note = n.json<{ id: string }>();
  const d = await device.post(`/api/notes/${note.id}/deadlines`, {
    rule: {
      kind: 'date',
      date: shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), -2),
      warnings: [],
    },
  });
  expect(d.status, d.text).toBe(201);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const item = (await adult.get('/api/deadlines?from=0001-01-01&to=9999-12-31')).json<{
    items: { id: string; calendarKey: string; actionState: { version: number } }[];
  }>().items[0];
  if (!item) throw new Error('Missing summary source');
  return { noteId: note.id, deadlineId: d.json<{ id: string }>().id, item };
}
async function setupPush(count = 2) {
  expect(
    (
      await adult.request('PATCH', '/api/notifications/settings', {
        json: {
          weeklyEnabled: false,
          quietStart: '00:00',
          quietEnd: '00:00',
          dailyBudget: 5,
          hideText: false,
        },
      })
    ).status,
  ).toBe(200);
  for (let index = 0; index < count; index++) {
    const device = index === 0 ? adult : world.device({ userAgent: `FictionalDevice/${index}` });
    if (index > 0) await device.signIn(world.boris.username, world.boris.password);
    expect(
      (
        await device.post('/api/push/subscriptions', {
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
          keys: { p256dh: `BA${'a'.repeat(85)}`, auth: 'a'.repeat(22) },
          deviceName: `Вымышленный телефон ${index}`,
        })
      ).status,
    ).toBe(201);
  }
}
it('календарь DST и два дома: неделя не равна фиксированным 168 часам', () => {
  const p = summaryPeriod(new Date('2026-10-25T19:00:00Z'), 'Europe/Berlin', 'weekly');
  expect(p.date).toBe('2026-10-25');
  expect((+p.end - +p.start) / 3600000).toBe(169);
  expect(summaryPeriod(new Date('2026-10-11T00:00:00Z'), 'Asia/Tokyo', 'morning').date).toBe(
    '2026-10-11',
  );
  expect(
    summaryPeriod(new Date('2026-10-11T00:00:00Z'), 'America/Los_Angeles', 'morning').date,
  ).toBe('2026-10-10');
});
it('два устройства получают одну логическую сводку; сетевой повтор не дублирует успех, 410 отзывает подписку', async () => {
  await source();
  await setupPush();
  const now = runAt();
  await scheduleSummaries(world.database.worker, now);
  const send = vi
    .fn<PushSender>()
    .mockRejectedValueOnce({ statusCode: 503 })
    .mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(2);
  const payload = send.mock.calls[1]?.[1];
  expect(payload).toMatchObject({ kind: 'summary', text: 'Готова утренняя сводка' });
  expect(JSON.stringify(payload)).not.toContain('срочное обязательство');
  await dispatchNotifications(world.database.worker, send, new Date(+now + 600000));
  expect(send).toHaveBeenCalledTimes(3);
  expect(
    (
      await world.database.admin.query(
        "SELECT count(DISTINCT notification_id)::int AS n FROM push_deliveries WHERE status='sent'",
      )
    ).rows[0].n,
  ).toBe(1);
  await scheduleSummaries(world.database.worker, new Date(+now + 86400000));
  send.mockRejectedValue({ statusCode: 410 });
  await dispatchNotifications(world.database.worker, send, new Date(+now + 86400000));
  expect((await world.database.admin.query('SELECT id FROM push_subscriptions')).rowCount).toBe(0);
});
it('старые summary включаются атомарно один раз; сбой откатывает связь, не создаёт рекурсивную сводку', async () => {
  const s = await source();
  await setupPush();
  const now = runAt();
  const n = (
    await world.database.admin.query(
      "INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at,status) VALUES($1,$2,$3,'summary') RETURNING id",
      [s.item.id, world.boris.id, new Date(+now - 3 * 86400000)],
    )
  ).rows[0];
  await world.database.admin.query(
    "CREATE FUNCTION public.fail_summary_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.record_table='summaries' THEN RAISE EXCEPTION 'Fixture summary failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_summary_fixture BEFORE INSERT ON deadline_notifications FOR EACH ROW EXECUTE FUNCTION public.fail_summary_fixture()",
  );
  try {
    await expect(scheduleSummaries(world.database.worker, now)).rejects.toThrow(
      'Fixture summary failure',
    );
    expect(
      (
        await world.database.admin.query(
          'SELECT summary_id FROM deadline_notifications WHERE id=$1',
          [n.id],
        )
      ).rows[0].summary_id,
    ).toBeNull();
    expect((await world.database.admin.query('SELECT id FROM summaries')).rowCount).toBe(0);
  } finally {
    await world.database.admin.query(
      'DROP TRIGGER fail_summary_fixture ON deadline_notifications; DROP FUNCTION public.fail_summary_fixture()',
    );
  }
  await Promise.all([
    scheduleSummaries(world.database.worker, now),
    scheduleSummaries(world.database.worker, now),
  ]);
  const summaryId = (
    await world.database.admin.query('SELECT summary_id FROM deadline_notifications WHERE id=$1', [
      n.id,
    ])
  ).rows[0].summary_id;
  expect(summaryId).toBeTruthy();
  const content = (await adult.get(`/api/summaries/${summaryId}`)).json<{
    deferred: unknown[];
    stuck: unknown[];
  }>();
  expect(content.deferred).toHaveLength(1);
  expect(content.stuck).toHaveLength(1);
  expect(
    (
      await world.database.admin.query(
        "SELECT id FROM deadline_notifications WHERE record_table='summaries'",
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, {
        action: 'dismiss',
        reason: 'Вымышленная причина',
        calendarKey: s.item.calendarKey,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(200);
  expect(
    (await adult.get(`/api/summaries/${summaryId}`)).json<{
      deferred: unknown[];
      stuck: unknown[];
    }>(),
  ).toMatchObject({ deferred: [], stuck: [] });
  const send = vi.fn<PushSender>();
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
});
it('планировщик идемпотентен; пустая сводка не отправляет push; бюджет не закрывает API', async () => {
  const n = await adult.post('/api/notes', { title: 'Вымышленное обязательство сводки' });
  expect(n.status, n.text).toBe(201);
  const noteId = n.json<{ id: string }>().id;
  expect(
    (
      await adult.post(`/api/notes/${noteId}/deadlines`, {
        rule: { kind: 'date', date: '2026-10-10', warnings: [] },
      })
    ).status,
  ).toBe(201);
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-11T05:00:00Z'),
    true,
  );
  const now = runAt();
  await Promise.all([
    scheduleSummaries(world.database.worker, now),
    scheduleSummaries(world.database.worker, now),
  ]);
  const rows = (
    await world.database.admin.query(
      "SELECT * FROM summaries WHERE account_id=$1 AND kind='morning'",
      [world.boris.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(
    (await adult.get(`/api/summaries/${rows[0].id}`)).status,
    world.requestLog.filter((x) => x.includes('Summary request failed')).join('\n'),
  ).toBe(200);
  expect((await admin.get(`/api/summaries/${rows[0].id}`)).status).toBe(404);
  const notifications = (
    await world.database.admin.query(
      "SELECT n.recipient_id FROM deadline_notifications n JOIN summaries s ON s.id=n.record_id WHERE record_table='summaries' AND status='pending' AND s.kind='morning'",
    )
  ).rows;
  expect(notifications).toEqual([{ recipient_id: world.boris.id }]);
  expect(
    (await adult.request('PATCH', '/api/notifications/settings', { json: { dailyBudget: 0 } }))
      .status,
  ).toBe(200);
  const subscription = await adult.post('/api/push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: { p256dh: `BA${'a'.repeat(85)}`, auth: 'a'.repeat(22) },
    deviceName: 'Вымышленный телефон',
  });
  expect(subscription.status, subscription.text).toBe(201);
  const send = vi.fn(async () => {});
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  expect(
    (await adult.get(`/api/summaries/${rows[0].id}`)).json<{ stuck: unknown[] }>().stuck.length,
  ).toBeGreaterThan(0);
  const patched = await adult.request('PATCH', '/api/notifications/settings', {
    json: { morningEnabled: false },
  });
  expect(patched.json<{ dailyBudget: number; morningEnabled: boolean }>()).toMatchObject({
    dailyBudget: 0,
    morningEnabled: false,
  });
});

it('неделя: подтверждённые дело, оплата, документ и обычный срок; отмена не оставляет выполненное, ожидание сегодня зависло', async () => {
  const zone = 'Asia/Yekaterinburg',
    today = localDate(new Date(), zone),
    weekday = new Date(`${today}T12:00Z`).getUTCDay();
  let end = calendarInstant(
    CalendarDate.parse(shiftTaskDate(today, (7 - weekday) % 7)),
    zone,
    '19:00',
  );
  if (end <= new Date())
    end = calendarInstant(CalendarDate.parse(shiftTaskDate(today, 7)), zone, '19:00');
  const task = (
    await adult.post('/api/tasks', {
      title: 'Вымышленное выполненное дело',
      householdId: world.houseId,
      planOn: today,
      dueOn: today,
    })
  ).json<{ id: string }>();
  const completion = await adult.post(`/api/tasks/${task.id}/status`, { status: 'done' });
  expect(completion.status, completion.text).toBe(200);
  const waiting = (
    await adult.post('/api/tasks', {
      title: 'Вымышленное ожидание сегодня',
      householdId: world.houseId,
      status: 'waiting',
      checkOn: today,
      waitingAccountId: world.anna.id,
      dueOn: today,
      planOn: today,
    })
  ).json<{ id: string }>();
  const doc = (
    await adult.post('/api/documents', {
      title: 'Вымышленный продлённый договор',
      data: { type: 'contract', expiresOn: today },
    })
  ).json<{ id: string }>();
  const renewal = await adult.post(`/api/documents/${doc.id}/renew`, {
    data: { type: 'contract', expiresOn: shiftTaskDate(today, 180) },
  });
  expect(renewal.status, renewal.text).toBe(201);
  const object = (await adult.post('/api/objects', { title: 'Вымышленный объект оплаты' })).json<{
    id: string;
  }>();
  const account = (
    await adult.post(`/api/objects/${object.id}/accounts`, { title: 'Вымышленный счёт' })
  ).json<{ id: string }>();
  const charge = (
    await adult.post(`/api/accounts/${account.id}/charges`, {
      period: today.slice(0, 7),
      totalCents: 10000,
      dueOn: today,
      idempotencyKey: randomUUID(),
    })
  ).json<{ id: string }>();
  const payment = await adult.post(`/api/charges/${charge.id}/payments`, {
    paidOn: today,
    amountCents: 10000,
    payer: { kind: 'member', accountId: world.boris.id },
    method: 'card',
    idempotencyKey: randomUUID(),
  });
  expect(payment.status, payment.text).toBe(201);
  const s = await source();
  expect(
    (
      await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, {
        action: 'complete',
        calendarKey: s.item.calendarKey,
        expectedVersion: 0,
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  await scheduleSummaries(world.database.worker, end);
  const id = (
    await world.database.admin.query(
      "SELECT id FROM summaries WHERE account_id=$1 AND kind='weekly'",
      [world.boris.id],
    )
  ).rows[0].id;
  const response = await adult.get(`/api/summaries/${id}`);
  expect(
    response.status,
    response.text + world.requestLog.filter((x) => x.includes('Summary request failed')).join('\n'),
  ).toBe(200);
  const data = response.json<{
    done: { type: string; id: string }[];
    stuck: { taskId: string }[];
    upcoming: { taskId: string }[];
  }>();
  expect(data.done.map((x) => x.type).sort()).toEqual(['deadline', 'document', 'payment', 'task']);
  expect(data.stuck.filter((x) => x.taskId === waiting.id)).toHaveLength(1);
  expect(data.upcoming.filter((x) => x.taskId === waiting.id)).toHaveLength(1);
  const cancelled = await adult.post(`/api/payments/${payment.json<{ id: string }>().id}/cancel`, {
    reason: 'Вымышленная отмена подтверждения',
  });
  expect(cancelled.status, cancelled.text).toBe(200);
  expect(
    (
      await adult.post(`/api/tasks/${task.id}/undo`, {
        eventId: completion.json<{ completionEventId: string }>().completionEventId,
      })
    ).status,
  ).toBe(200);
  expect(
    (await adult.get(`/api/summaries/${id}`))
      .json<{ done: { type: string }[] }>()
      .done.map((x) => x.type)
      .sort(),
  ).toEqual(['deadline', 'document']);
});
it('напоминание дела в точное время: одна очередь; перенос отменяет старое, выключенный вид не доставляется', async () => {
  const date = CalendarDate.parse(shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), 1)),
    now = calendarInstant(date, 'Asia/Yekaterinburg', '18:00');
  const t = await adult.post('/api/tasks', {
    title: 'Вымышленное точное напоминание',
    planOn: date,
    planTime: '18:00',
    householdId: world.houseId,
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(t.status, t.text).toBe(201);
  const id = t.json<{ id: string }>().id;
  const worker = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(worker, new Date(), true);
  await enqueueDeadlineWarnings(worker, now);
  await enqueueDeadlineWarnings(worker, now);
  const rows = (
    await world.database.admin.query(
      "SELECT n.id,n.warning_at,n.notification_kind FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id JOIN deadlines d ON d.id=o.deadline_id WHERE d.task_id=$1 AND n.status='pending'",
      [id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].warning_at.toISOString()).toBe(now.toISOString());
  expect(rows[0].notification_kind).toBe('task_reminder');
  expect(
    (await adult.request('PATCH', `/api/tasks/${id}`, { json: { planTime: '19:00' } })).status,
  ).toBe(200);
  await refreshDeadlines(worker, new Date(), true);
  await enqueueDeadlineWarnings(worker, calendarInstant(date, 'Asia/Yekaterinburg', '19:00'));
  expect(
    (
      await world.database.admin.query('SELECT status FROM deadline_notifications WHERE id=$1', [
        rows[0].id,
      ])
    ).rows[0].status,
  ).toBe('cancelled');
  await setupPush(1);
  expect(
    (await adult.request('PATCH', '/api/notifications/settings', { json: { enabledKinds: [] } }))
      .status,
  ).toBe(200);
  const send = vi.fn<PushSender>();
  await dispatchNotifications(
    world.database.worker,
    send,
    calendarInstant(date, 'Asia/Yekaterinburg', '19:00'),
  );
  expect(send).not.toHaveBeenCalled();
});
it('простой создаёт только актуальное утро; тихие часы откладывают его, 404 отзывает устройство', async () => {
  await source();
  await setupPush(1);
  const now = calendarInstant(
    CalendarDate.parse(shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), 30)),
    'Asia/Yekaterinburg',
    '23:00',
  );
  expect(
    (
      await adult.request('PATCH', '/api/notifications/settings', {
        json: { quietStart: '22:00', quietEnd: '08:00' },
      })
    ).status,
  ).toBe(200);
  await scheduleSummaries(world.database.worker, now);
  await scheduleSummaries(world.database.worker, now);
  const rows = (
    await world.database.admin.query(
      "SELECT local_date::text AS date FROM summaries WHERE account_id=$1 AND kind='morning'",
      [world.boris.id],
    )
  ).rows;
  expect(rows).toEqual([{ date: summaryPeriod(now, 'Asia/Yekaterinburg', 'morning').date }]);
  const send = vi.fn<PushSender>().mockRejectedValue({ statusCode: 404 });
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  const retry = (
    await world.database.admin.query(
      "SELECT min(next_attempt_at) AS at FROM push_deliveries WHERE status='pending'",
    )
  ).rows[0].at as Date;
  expect(localDate(retry, 'Asia/Yekaterinburg')).toBe(
    shiftTaskDate(localDate(now, 'Asia/Yekaterinburg'), 1),
  );
  expect(
    (
      await adult.request('PATCH', '/api/notifications/settings', {
        json: { quietStart: '00:00', quietEnd: '00:00' },
      })
    ).status,
  ).toBe(200);
  await world.database.admin.query(
    "UPDATE push_deliveries SET next_attempt_at=$1 WHERE status='pending'",
    [now],
  );
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await world.database.admin.query('SELECT id FROM push_subscriptions')).rowCount).toBe(0);
});
it('перенос в личное, новый ответственный, корзина и уход после планирования перепроверяются API и push', async () => {
  for (const change of ['personal', 'assignee', 'trash', 'leave'] as const) {
    for (const table of ['deadline_notifications', 'summaries', 'deadlines', 'notes'])
      await world.database.admin.query(`DELETE FROM ${table}`);
    const s = await source(true, change === 'personal' ? admin : adult);
    if (change === 'personal') {
      expect(
        (
          await admin.post(`/api/deadlines/${s.deadlineId}/assignee`, {
            assigneeId: world.boris.id,
          })
        ).status,
      ).toBe(200);
      await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
    }
    await setupPush(1);
    const now = runAt();
    await scheduleSummaries(world.database.worker, now);
    const summary = (
      await world.database.admin.query(
        "SELECT id FROM summaries WHERE account_id=$1 AND kind='morning'",
        [world.boris.id],
      )
    ).rows[0];
    if (change === 'personal') {
      const moved = await admin.post(`/api/notes/${s.noteId}/personal`, { confirmed: true });
      expect(moved.status, moved.text).toBe(200);
    } else if (change === 'assignee')
      expect(
        (await adult.post(`/api/deadlines/${s.deadlineId}/assignee`, { assigneeId: world.anna.id }))
          .status,
      ).toBe(200);
    else if (change === 'trash')
      expect((await adult.post(`/api/notes/${s.noteId}/trash`, {})).status).toBe(200);
    else
      await world.database.admin.query(
        'UPDATE space_members SET left_at=now(),left_by=$2 WHERE space_id=$1 AND account_id=$2',
        [world.houseId, world.boris.id],
      );
    {
      const response = await adult.get(`/api/summaries/${summary.id}`);
      if (change === 'leave') expect(response.status).toBe(404);
      else {
        expect(response.status, response.text).toBe(200);
        expect(response.json<{ stuck: unknown[] }>().stuck).toEqual([]);
      }
      const send = vi.fn<PushSender>();
      await dispatchNotifications(world.database.worker, send, now);
      expect(send).not.toHaveBeenCalled();
    }
  }
});
