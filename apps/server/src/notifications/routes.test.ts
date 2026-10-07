import { randomBytes, randomUUID } from 'node:crypto';
import { TZDate } from '@date-fns/tz';
import { createWorkerDatabase, sql } from '@homecrm/db';
import { format } from 'date-fns';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { buildApp } from '../app.ts';
import {
  enqueueDeadlineWarnings,
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../deadlines/engine.ts';
import { startDeadlineJobs } from '../deadlines/jobs.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { dispatchNotifications } from './dispatcher.ts';
import type { PushSender } from './transport.ts';

let world: World, adult: Device, child: Device, admin: Device;
const now = new Date('2026-10-07T04:00:00Z');
const send = vi.fn<PushSender>();
function subscription() {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString('base64url'),
    },
    deviceName: 'Вымышленный телефон',
  };
}
async function subscribe(device = adult) {
  const body = subscription();
  const result = await device.post('/api/push/subscriptions', body);
  expect(result.status, result.text).toBe(201);
  return { ...body, id: result.json<{ id: string }>().id };
}
async function warning(device = adult, date = '2026-10-07', common = false) {
  const note = await device.post('/api/notes', {
    title: 'Секретное вымышленное название',
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(note.status, note.text).toBe(201);
  const noteId = note.json<{ id: string }>().id;
  const result = await device.post(`/api/notes/${noteId}/deadlines`, {
    rule: { kind: 'date', date, time: '09:00', warnings: [0] },
  });
  expect(result.status, result.text).toBe(201);
  const db = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(db, now);
  await enqueueDeadlineWarnings(db, now);
  return noteId;
}
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
beforeEach(async () => {
  send.mockReset();
  send.mockResolvedValue(undefined);
  await world.clearRateLimits();
  await world.database.admin.query('DELETE FROM deadlines');
  await world.database.admin.query('DELETE FROM push_subscriptions');
  await world.database.admin.query('DELETE FROM push_attempts');
  await world.database.admin.query('DELETE FROM notification_settings');
});
afterAll(async () => {
  await world?.close();
});
it('API возвращает defaults, валидирует настройки и подписку, скрывает endpoint и закрывает чужое личное', async () => {
  const sub = await subscribe();
  expect((await adult.get('/api/notifications/settings')).json()).toEqual({
    quietStart: '22:00',
    quietEnd: '08:00',
    dailyBudget: 5,
    enabledKinds: ['deadline'],
    hideText: true,
  });
  expect((await admin.get('/api/push/subscriptions')).json()).toEqual([]);
  expect((await child.get('/api/push/subscriptions')).json()).toEqual([]);
  expect((await adult.get('/api/push/subscriptions')).text).not.toContain(sub.endpoint);
  expect((await world.device().get('/api/notifications/deliveries')).status).toBe(401);
  expect(
    (await adult.request('PATCH', '/api/notifications/settings', { json: { dailyBudget: -1 } }))
      .status,
  ).toBe(400);
  expect(
    (
      await adult.post('/api/push/subscriptions', {
        ...subscription(),
        endpoint: 'https://127.0.0.1/secret',
      })
    ).status,
  ).toBe(400);
  expect((await admin.post('/api/push/subscriptions', { ...sub, id: undefined })).status).toBe(201);
  expect((await adult.get('/api/push/subscriptions')).json()).toEqual([]);
  expect((await admin.get('/api/push/subscriptions')).json<unknown[]>()).toHaveLength(1);
  const updated = await adult.request('PATCH', '/api/notifications/settings', {
    json: { hideText: false, dailyBudget: 2 },
  });
  expect(updated.status, updated.text).toBe(200);
  expect((await adult.get('/api/notifications/settings')).json()).toMatchObject({
    hideText: false,
    dailyBudget: 2,
  });
  expect((await admin.get('/api/notifications/settings')).json()).toMatchObject({
    hideText: true,
    dailyBudget: 5,
  });
  expect(world.requestLog.join('')).not.toContain(sub.endpoint);
  await adult.request('PATCH', '/api/notifications/settings', { json: { hideText: true } });
  expect((await adult.get('/api/notifications/settings')).json()).toMatchObject({
    dailyBudget: 2,
    hideText: true,
  });
  expect(
    (await adult.post('/api/export', { password: world.boris.password })).json(),
  ).toHaveProperty('notificationSettings.dailyBudget', 2);
});
it('отправляет один раз на каждое устройство со скрытием текста и сохраняет журнал только владельцу', async () => {
  await adult.request('PATCH', '/api/notifications/settings', { json: { dailyBudget: 1 } });
  await subscribe();
  const second = world.device();
  await second.signIn(world.boris.username, world.boris.password);
  await subscribe(second);
  const id = await warning();
  await dispatchNotifications(world.database.worker, send, now);
  await enqueueDeadlineWarnings(createWorkerDatabase(world.database.worker), now);
  await Promise.all([
    dispatchNotifications(world.database.worker, send, now),
    dispatchNotifications(world.database.worker, send, now),
  ]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0]?.[1]).toEqual({
    kind: 'deadline',
    recordId: id,
    text: 'В HomeCRM есть новое',
  });
  expect((await adult.get('/api/notifications/deliveries')).json<unknown[]>()).toHaveLength(2);
  expect((await admin.get('/api/notifications/deliveries')).json()).toEqual([]);
  expect(
    (await world.database.admin.query('SELECT last_success_at FROM push_subscriptions')).rows.every(
      (x) => +x.last_success_at === +now,
    ),
  ).toBe(true);
});
it('тихие часы откладывают до конца, бюджет один на событие на всех устройствах; превышение в сводку', async () => {
  await subscribe();
  await warning();
  const quiet = new Date('2026-10-07T18:00:00Z');
  await dispatchNotifications(world.database.worker, send, quiet);
  expect(send).not.toHaveBeenCalled();
  expect(
    (
      await world.database.admin.query('SELECT next_attempt_at FROM push_deliveries')
    ).rows[0]?.next_attempt_at.toISOString(),
  ).toBe('2026-10-08T03:00:00.000Z');
  await dispatchNotifications(world.database.worker, send, new Date('2026-10-08T03:00:00Z'));
  expect(send).toHaveBeenCalledTimes(1);
  await adult.request('PATCH', '/api/notifications/settings', { json: { dailyBudget: 1 } });
  await warning();
  await dispatchNotifications(world.database.worker, send, new Date('2026-10-08T03:00:00Z'));
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (
      await world.database.admin.query(
        "SELECT count(*)::int n FROM push_deliveries WHERE status='summary'",
      )
    ).rows[0]?.n,
  ).toBe(1);
});
it('повтор с растущей паузой и удаление подписки при 404/410, без секретов в журнале', async () => {
  const sub = await subscribe();
  await warning();
  send.mockRejectedValueOnce({ statusCode: 503, body: sub.endpoint });
  await dispatchNotifications(world.database.worker, send, now);
  await dispatchNotifications(world.database.worker, send, new Date(+now + 29_000));
  expect(send).toHaveBeenCalledTimes(1);
  send.mockRejectedValueOnce({ statusCode: 500 });
  await dispatchNotifications(world.database.worker, send, new Date(+now + 30_000));
  expect(
    (await world.database.admin.query('SELECT next_attempt_at FROM push_deliveries')).rows[0]
      ?.next_attempt_at,
  ).toEqual(new Date(+now + 90_000));
  send.mockRejectedValueOnce({ statusCode: 410, body: sub.endpoint });
  await dispatchNotifications(world.database.worker, send, new Date(+now + 90_000));
  expect((await adult.get('/api/push/subscriptions')).json()).toEqual([]);
  await subscribe();
  await warning();
  send.mockRejectedValueOnce({ statusCode: 404 });
  await dispatchNotifications(world.database.worker, send, now);
  expect((await adult.get('/api/push/subscriptions')).json()).toEqual([]);
  expect((await adult.get('/api/notifications/deliveries')).text).not.toContain(sub.endpoint);
});
it('после простоя старше суток уходит в сводку; неизвестная аварийная отправка не повторяется', async () => {
  await subscribe();
  await warning(adult, '2026-10-05');
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  expect(
    (await world.database.admin.query('SELECT status FROM deadline_notifications')).rows,
  ).toEqual([{ status: 'summary' }]);
  await warning();
  await world.database.admin.query(
    `INSERT INTO push_deliveries(notification_id,account_id,device_id,status,reserved_at)
    SELECT n.id,n.recipient_id,s.id,'sending',$1 FROM deadline_notifications n JOIN push_subscriptions s ON s.account_id=n.recipient_id WHERE n.status='pending'`,
    [new Date(+now - 700_000)],
  );
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  expect(
    (await world.database.admin.query("SELECT result FROM push_attempts WHERE result='uncertain'"))
      .rows,
  ).toHaveLength(1);
});
it('перед отправкой перепроверяет перенос в чужое личное, аудиторию ребёнка и текущее членство', async () => {
  await subscribe(child);
  const id = await warning(child);
  // Имитируем устаревшую очередь после переноса источника: изменяем только источник, не очередь.
  await world.database.admin.query('ALTER TABLE notes DISABLE TRIGGER notes_deadlines');
  try {
    await world.database.admin.query(
      "UPDATE notes SET space_id=$2,space_kind='household',audience='adults',assignee_id=$3 WHERE id=$1",
      [id, world.houseId, world.anna.id],
    );
  } finally {
    await world.database.admin.query('ALTER TABLE notes ENABLE TRIGGER notes_deadlines');
  }
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await subscribe();
  const personal = await warning();
  await world.database.admin.query('ALTER TABLE notes DISABLE TRIGGER notes_deadlines');
  try {
    await world.database.admin.query(
      "UPDATE notes SET space_id=$2,space_kind='personal',audience=NULL WHERE id=$1",
      [personal, world.anna.personalSpaceId],
    );
  } finally {
    await world.database.admin.query('ALTER TABLE notes ENABLE TRIGGER notes_deadlines');
  }
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
});
it('отключение вида отменяет отправку; разрешённый текст не содержит название источника', async () => {
  await subscribe();
  await warning();
  await adult.request('PATCH', '/api/notifications/settings', { json: { enabledKinds: [] } });
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { enabledKinds: ['deadline'], hideText: false },
  });
  await warning();
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[1].text).toBe('Подходит срок записи в HomeCRM');
  expect(JSON.stringify(send.mock.calls)).not.toContain('Секретное вымышленное название');
});
it('публичный ключ доступен до входа; чужую подписку нельзя удалить', async () => {
  const key = webpush.generateVAPIDKeys().publicKey;
  const app = buildApp(
    { LOG_LEVEL: 'silent', APP_VERSION: 'test', VAPID_PUBLIC_KEY: key },
    { auth: world.module },
  );
  try {
    expect((await app.inject({ url: '/api/push/key' })).json()).toEqual({ publicKey: key });
  } finally {
    await app.close();
  }
  const sub = await subscribe();
  for (const device of [admin, adult]) {
    const reply = await world.app.inject({
      method: 'DELETE',
      url: `/api/push/subscriptions/${sub.id}`,
      headers: {
        origin: 'http://homecrm.test',
        cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      },
    });
    expect(reply.statusCode).toBe(device === adult ? 204 : 404);
  }
});
it('pg-boss запускает диспетчер после расчёта и не повторяет успешную доставку', async () => {
  await subscribe();
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00' },
  });
  const instant = new TZDate(Date.now() - 60_000, 'Asia/Yekaterinburg');
  const note = await adult.post('/api/notes', { title: 'Вымышленный срок очереди' });
  const reply = await adult.post(`/api/notes/${note.json<{ id: string }>().id}/deadlines`, {
    rule: {
      kind: 'date',
      date: format(instant, 'yyyy-MM-dd'),
      time: format(instant, 'HH:mm'),
      warnings: [0],
    },
  });
  expect(reply.status, reply.text).toBe(201);
  const pool = world.database.pool('worker', 4),
    errors: unknown[] = [];
  const stop = await startDeadlineJobs(
    pool,
    'Asia/Yekaterinburg',
    (error) => errors.push(error),
    send,
  );
  try {
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), {
      timeout: 15_000,
      interval: 100,
    });
  } finally {
    await stop();
  }
  await dispatchNotifications(pool, send);
  expect(send).toHaveBeenCalledTimes(1);
  expect(errors).toEqual([]);
});
it('отзыв сессии и уход из дома немедленно удаляют подписки', async () => {
  const other = world.device();
  await other.signIn(world.boris.username, world.boris.password);
  const sub = await subscribe(other);
  const session = (
    await world.database.admin.query('SELECT session_id FROM push_subscriptions WHERE id=$1', [
      sub.id,
    ])
  ).rows[0]?.session_id;
  expect((await adult.post('/api/auth/revoke-session', { id: session })).status).toBe(200);
  expect((await adult.get('/api/push/subscriptions')).json()).toEqual([]);
  await subscribe();
  await warning();
  const row = (
    await world.database.admin.query(
      'SELECT left_at FROM space_members WHERE account_id=$1 AND space_id=$2',
      [world.boris.id, world.houseId],
    )
  ).rows[0];
  try {
    await world.database.admin.query(
      'UPDATE space_members SET left_at=now(),left_by=account_id WHERE account_id=$1 AND space_id=$2',
      [world.boris.id, world.houseId],
    );
    expect((await world.database.admin.query('SELECT id FROM push_subscriptions')).rows).toEqual(
      [],
    );
    await dispatchNotifications(world.database.worker, send, now);
    expect(send).not.toHaveBeenCalled();
  } finally {
    await world.database.admin.query('ALTER TABLE space_members DISABLE TRIGGER USER');
    await world.database.admin.query(
      'UPDATE space_members SET left_at=$3,left_by=NULL WHERE account_id=$1 AND space_id=$2',
      [world.boris.id, world.houseId, row?.left_at],
    );
    await world.database.admin.query('ALTER TABLE space_members ENABLE TRIGGER USER');
  }
});

it('пересчёт и A→B→A создают новую доставку вместо оживления отменённой; sent не повторяется', async () => {
  await subscribe();
  const id = await warning(adult, '2026-10-07', true);
  const db = createWorkerDatabase(world.database.worker);
  await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.execute(sql`UPDATE notes SET assignee_id=${world.anna.id} WHERE id=${id}`),
  );
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  const cancelled = (await world.database.admin.query('SELECT id,status FROM push_deliveries'))
    .rows;
  expect(cancelled).toHaveLength(1);
  expect(cancelled[0]?.status).toBe('cancelled');
  await world.module.appDb.withAccount(world.anna.id, (tx) =>
    tx.execute(sql`UPDATE notes SET assignee_id=${world.boris.id} WHERE id=${id}`),
  );
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (
      await world.database.admin.query('SELECT id,status FROM push_deliveries WHERE id=$1', [
        cancelled[0]?.id,
      ])
    ).rows,
  ).toEqual(cancelled);
  const sent = send.mock.calls[0]?.[2];
  expect(sent).not.toBe(cancelled[0]?.id);
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
});
it('окно пересчёта не теряет напоминание: отменённая попытка остаётся, новая отправляется', async () => {
  await subscribe();
  const id = await warning();
  const db = createWorkerDatabase(world.database.worker);
  const deadline = (
    await world.database.admin.query('SELECT id,rule FROM deadlines WHERE note_id=$1', [id])
  ).rows[0];
  expect(
    (
      await adult.request('PATCH', `/api/deadlines/${deadline.id}`, {
        json: { rule: deadline.rule },
      })
    ).status,
  ).toBe(200);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    (await world.database.admin.query('SELECT status FROM push_deliveries ORDER BY id')).rows,
  ).toEqual([{ status: 'cancelled' }, { status: 'sent' }]);
});
it('передача endpoint другому участнику удаляет прежний UUID и не отправляет ему push по чужой записи', async () => {
  const sub = await subscribe();
  await warning();
  const transfer = await admin.post('/api/push/subscriptions', {
    endpoint: sub.endpoint,
    keys: sub.keys,
    deviceName: 'Другой вымышленный телефон',
  });
  expect(transfer.status, transfer.text).toBe(201);
  expect(transfer.json<{ id: string }>().id).not.toBe(sub.id);
  expect((await adult.get('/api/push/subscriptions')).json()).toEqual([]);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await warning(admin);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
});
it('диспетчер проверяет именно аудиторию: ребёнок остаётся ответственным за устаревшую запись «Взрослые»', async () => {
  await subscribe(child);
  const id = await warning(child);
  // Только одноразовая БД: намеренно моделируем устаревшие данные в обход FK и каскада.
  await world.database.admin.query('ALTER TABLE notes DISABLE TRIGGER ALL');
  try {
    await world.database.admin.query(
      "UPDATE notes SET space_id=$2,space_kind='household',audience='adults',assignee_id=$3 WHERE id=$1",
      [id, world.houseId, world.vera.id],
    );
  } finally {
    await world.database.admin.query('ALTER TABLE notes ENABLE TRIGGER ALL');
  }
  expect(
    (await world.database.admin.query('SELECT assignee_id FROM notes WHERE id=$1', [id])).rows[0]
      ?.assignee_id,
  ).toBe(world.vera.id);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  expect((await world.database.admin.query('SELECT status FROM push_deliveries')).rows).toEqual([
    { status: 'cancelled' },
  ]);
});
it('диспетчер не отправляет ушедшему участнику даже при оставшейся подписке и готовой очереди', async () => {
  await subscribe();
  await warning(adult, '2026-10-07', true);
  await world.database.admin.query(
    'ALTER TABLE space_members DISABLE TRIGGER space_members_push_cleanup',
  );
  try {
    await world.database.admin.query(
      'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
      [world.houseId, world.boris.id],
    );
  } finally {
    await world.database.admin.query(
      'ALTER TABLE space_members ENABLE TRIGGER space_members_push_cleanup',
    );
  }
  expect((await world.database.admin.query('SELECT id FROM push_subscriptions')).rowCount).toBe(1);
  expect(
    (
      await world.database.admin.query(
        "SELECT id FROM deadline_notifications WHERE status='pending'",
      )
    ).rowCount,
  ).toBe(1);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
});
