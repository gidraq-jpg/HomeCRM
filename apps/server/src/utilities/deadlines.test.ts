import { randomBytes, randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import {
  enqueueDeadlineWarnings,
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../deadlines/engine.ts';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device, admin: Device;
const now = new Date('2026-11-20T04:00:00Z');
const readingRule = {
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: 20, endDay: 25 },
};
const paymentRule = { kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 23 } };
interface Account {
  id: string;
  data: Record<string, unknown>;
}
interface Meter {
  id: string;
  data: Record<string, unknown>;
}
interface Item {
  id: string;
  deadlineId: string;
  date: string;
  sourceKind: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  objectId: string;
  object: { id: string; title: string; status: string };
  utilityAccount: { id: string; number: string };
  meter: { id: string };
  primaryAction: { kind: string };
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
  await world.clearRateLimits();
  await world.database.admin.query('DELETE FROM objects');
  await world.database.admin.query('DELETE FROM push_subscriptions');
  await world.database.admin.query('DELETE FROM notification_settings');
  await world.database.admin.query('DELETE FROM push_attempts');
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
afterAll(async () => {
  await world?.close();
});
async function object(personal = false) {
  const res = await adult.post('/api/objects', {
    title: 'Вымышленная квартира сроков',
    objectType: 'property',
    typeData: { status: 'rented' },
    placement: personal
      ? { spaceId: world.boris.personalSpaceId }
      : { spaceId: world.houseId, audience: 'adults' },
  });
  expect(res.status, res.text).toBe(201);
  return res.json<{ id: string }>().id;
}
async function account(parent: string, data: Record<string, unknown> = {}) {
  const res = await adult.post(`/api/objects/${parent}/accounts`, {
    data: { number: 'TEST-123', readingRule, paymentRule, ...data },
  });
  expect(res.status, res.text).toBe(201);
  return res.json<Account>();
}
async function meter(parent: string, accountId: string | null, data: Record<string, unknown> = {}) {
  const res = await adult.post(`/api/objects/${parent}/meters`, {
    utilityAccountId: accountId,
    data: { resource: 'cold_water', ...data },
  });
  expect(res.status, res.text).toBe(201);
  return res.json<Meter>();
}
async function refresh(date = now) {
  await refreshDeadlines(createWorkerDatabase(world.database.worker), date, true);
}
async function radar(device = adult) {
  const res = await device.get('/api/deadlines?from=2026-01-01&to=2028-12-31');
  expect(res.status, res.text).toBe(200);
  return res.json<{ items: Item[]; recalculating: boolean }>();
}
async function read(id: string, date = '2026-11-20', value = '10') {
  const res = await adult.post(`/api/meters/${id}/readings`, { occurredOn: date, values: [value] });
  expect(res.status, res.text).toBe(201);
  return res.json<{ id: string }>().id;
}
async function transmit(parent: string, ids: string[]) {
  const res = await adult.post(`/api/objects/${parent}/readings/transmit`, {
    readingIds: ids,
    method: 'Вымышленный сайт',
  });
  expect(res.status, res.text).toBe(200);
}
it('DEAD-2/4/5: окно двух приборов, контекст одним ответом, корзина показания вновь открывает окно', async () => {
  const parent = await object();
  const acc = await account(parent);
  const first = await meter(parent, acc.id);
  const second = await meter(parent, acc.id);
  await refresh();
  const window = (await radar()).items.find(
    (r) => r.sourceKind === 'readings' && r.date === '2026-11-20',
  );
  expect(window).toMatchObject({
    objectId: parent,
    object: { id: parent, title: 'Вымышленная квартира сроков', status: 'rented' },
    utilityAccount: { id: acc.id, number: 'TEST-123' },
    primaryAction: { kind: 'enter_readings' },
    startsAt: '2026-11-19T19:00:00.000Z',
    endsAt: '2026-11-25T18:59:59.999Z',
  });
  const a = await read(first.id);
  const b = await read(second.id);
  await transmit(parent, [a]);
  expect((await radar()).items.some((r) => r.id === window?.id)).toBe(true);
  await transmit(parent, [b]);
  expect((await radar()).items.some((r) => r.id === window?.id)).toBe(false);
  expect((await adult.post(`/api/readings/${b}/trash`)).status).toBe(200);
  expect((await radar()).items.some((r) => r.id === window?.id)).toBe(true);
  expect((await child.get('/api/deadlines?from=2026-01-01&to=2028-12-31')).text).not.toContain(
    parent,
  );
  expect(
    (
      await adult.request('PATCH', `/api/deadlines/${window?.deadlineId}`, {
        json: { rule: paymentRule },
      })
    ).status,
  ).toBe(409);
});
it('DEAD-5: показание до окна не закрывает его, automatic/not_required отсутствуют в радаре', async () => {
  const parent = await object();
  const acc = await account(parent);
  const m = await meter(parent, acc.id);
  await transmit(parent, [await read(m.id, '2026-11-19')]);
  await refresh();
  expect(
    (await radar()).items.some((r) => r.sourceKind === 'readings' && r.date === '2026-11-20'),
  ).toBe(true);
  for (const method of ['automatic', 'not_required']) {
    const res = await adult.request('PATCH', `/api/accounts/${acc.id}`, {
      json: { data: { ...acc.data, transmission: { method } } },
    });
    expect(res.status, res.text).toBe(200);
    await refresh();
    expect((await radar()).items.some((r) => r.sourceKind === 'readings')).toBe(false);
  }
});
it('DEAD-2: правка, самостоятельная корзина, восстановление, перенос, аудитория и часовой пояс', async () => {
  const parent = await object(true);
  const acc = await account(parent);
  await meter(parent, acc.id);
  await refresh();
  expect((await radar(admin)).items).toEqual([]);
  const update = await adult.request('PATCH', `/api/accounts/${acc.id}`, {
    json: {
      data: {
        ...acc.data,
        readingRule: { ...readingRule, repeat: { unit: 'month', day: 28, endDay: 5 } },
      },
    },
  });
  expect(update.status, update.text).toBe(200);
  expect((await radar()).recalculating).toBe(true);
  await refresh();
  const win = (await radar()).items.find(
    (r) => r.sourceKind === 'readings' && r.date === '2026-11-28',
  );
  expect(win?.endsAt).toBe('2026-12-05T18:59:59.999Z');
  const trashed = await adult.post(`/api/accounts/${acc.id}/trash`);
  expect(trashed.status, trashed.text).toBe(200);
  await refresh();
  expect((await radar()).items).toEqual([]);
  expect((await adult.post(`/api/accounts/${acc.id}/restore`)).status).toBe(200);
  await refresh();
  expect((await radar()).items.some((r) => r.id === win?.id)).toBe(true);
  const shared = await adult.post(`/api/objects/${parent}/share`, {
    spaceId: world.houseId,
    audience: 'adults',
  });
  expect(shared.status, shared.text).toBe(200);
  await refresh();
  expect((await radar(child)).items).toEqual([]);
  expect((await radar(admin)).items.length).toBeGreaterThan(0);
  expect(
    (
      await adult.post(`/api/objects/${parent}/audience`, {
        audience: 'household',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  await refresh();
  expect((await radar(child)).items.length).toBeGreaterThan(0);
  expect((await adult.post(`/api/objects/${parent}/trash`)).status).toBe(200);
  expect((await radar()).items).toEqual([]);
  expect((await adult.post(`/api/objects/${parent}/restore`)).status).toBe(200);
  await refresh();
  expect(
    (
      await admin.request('PATCH', `/api/households/${world.houseId}/time-zone`, {
        json: { timeZone: 'Asia/Vladivostok' },
      })
    ).status,
  ).toBe(200);
  await refresh();
  expect((await radar()).items.find((r) => r.date === '2026-11-28')?.startsAt).toBe(
    '2026-11-27T14:00:00.000Z',
  );
});
it('DEAD-5: платёж отмечается вручную идемпотентно, поверка сдвигается на год', async () => {
  const parent = await object();
  await account(parent);
  const m = await meter(parent, null, { verifiedOn: '2025-11-20', verificationYears: 1 });
  await refresh();
  const payment = (await radar()).items.find(
    (r) => r.sourceKind === 'payment' && r.date === '2026-11-23',
  );
  expect(payment?.primaryAction.kind).toBe('mark_payment');
  const url = `/api/deadlines/occurrences/${payment?.id}/complete-payment`;
  const first = await adult.post(url, {});
  expect(first.status, first.text).toBe(200);
  expect((await adult.post(url, {})).json()).toEqual(first.json());
  await refresh();
  expect((await radar()).items.some((r) => r.id === payment?.id)).toBe(false);
  expect((await adult.post(url, { completed: false })).status).toBe(200);
  expect((await radar()).items.some((r) => r.id === payment?.id)).toBe(true);
  const verify = await adult.post(`/api/meters/${m.id}/verify`, { verifiedOn: '2026-11-20' });
  expect(verify.status, verify.text).toBe(200);
  expect(verify.json<Meter>().data.nextVerificationOn).toBe('2027-11-20');
  await refresh(new Date('2027-09-25T04:00:00Z'));
  const dates = (
    await world.database.admin.query(
      'SELECT date::text FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE d.meter_id=$1',
      [m.id],
    )
  ).rows;
  expect(dates).toEqual([{ date: '2027-11-20' }]);
  expect((await child.post(url, {})).status).toBe(404);
});
async function subscribe(device: Device) {
  const res = await device.post('/api/push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString('base64url'),
    },
    deviceName: 'Вымышленный телефон',
  });
  expect(res.status, res.text).toBe(201);
  return res.json<{ id: string }>().id;
}
it('NOTIF-3: каждый вид получает ответственный объекта, скрытие текста, ребёнку по «Взрослым» ничего', async () => {
  const parent = await object();
  const acc = await account(parent);
  await meter(parent, acc.id, { nextVerificationOn: '2027-01-19' });
  const adultDevice = await subscribe(adult);
  await subscribe(child);
  await subscribe(admin);
  expect(
    (
      await adult.request('PATCH', '/api/notifications/settings', {
        json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100, hideText: false },
      })
    ).status,
  ).toBe(200);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  const db = createWorkerDatabase(world.database.worker);
  await refresh();
  for (const date of [
    '2026-11-20T04:00:00Z',
    '2026-11-23T04:00:00Z',
    '2026-11-24T04:00:00Z',
    '2026-11-25T04:00:00Z',
  ]) {
    await enqueueDeadlineWarnings(db, new Date(date));
    await dispatchNotifications(world.database.worker, send, new Date(date));
  }
  const kinds = send.mock.calls.map((c) => c[1].notificationKind);
  expect(kinds).toEqual(
    expect.arrayContaining([
      'readings_open',
      'readings_closing',
      'readings_last_day',
      'payment_upcoming',
      'payment_due',
      'verification',
    ]),
  );
  const devices = (
    await world.database.admin.query('SELECT DISTINCT device_id FROM push_deliveries')
  ).rows;
  expect(devices).toEqual([{ device_id: adultDevice }]);
  expect(send.mock.calls.map((c) => c[1].text)).toEqual(
    expect.arrayContaining([
      'Открылось окно показаний',
      'Окно закрывается завтра',
      'Оплата через 3 дня',
      'Оплата сегодня',
      'Подходит срок поверки',
    ]),
  );
  expect(send.mock.calls.every((c) => c[1].recordId === parent)).toBe(true);
  expect(JSON.stringify(send.mock.calls)).not.toContain('Вымышленная квартира сроков');
  await adult.request('PATCH', '/api/notifications/settings', { json: { hideText: true } });
  await enqueueDeadlineWarnings(db, new Date('2026-12-20T04:00:00Z'));
  await dispatchNotifications(world.database.worker, send, new Date('2026-12-20T04:00:00Z'));
  expect(send.mock.calls.at(-1)?.[1].text).toBe('В HomeCRM есть новое');
});
it('NOTIF-3: перед отправкой перепроверяются закрытие окна и смена ответственного', async () => {
  const parent = await object();
  const acc = await account(parent, { paymentRule: null });
  const m = await meter(parent, acc.id);
  await subscribe(adult);
  await refresh();
  const db = createWorkerDatabase(world.database.worker);
  await enqueueDeadlineWarnings(db, now);
  await transmit(parent, [await read(m.id)]);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await subscribe(admin);
  const changed = await adult.request('PATCH', `/api/objects/${parent}`, {
    json: { responsibleId: world.anna.id },
  });
  expect(changed.status, changed.text).toBe(200);
  await refresh();
  const later = new Date('2026-12-20T04:00:00Z');
  await enqueueDeadlineWarnings(db, later);
  await dispatchNotifications(world.database.worker, send, later);
  expect(send).toHaveBeenCalledTimes(1);
  const delivered = (
    await world.database.admin.query(
      "SELECT DISTINCT account_id FROM push_deliveries WHERE status='sent'",
    )
  ).rows;
  expect(delivered).toEqual([{ account_id: world.anna.id }]);
});
it('NOTIF-2/3: коммунальные push соблюдают тихие часы, выбор видов и дневной бюджет', async () => {
  const parent = await object();
  const acc = await account(parent);
  await meter(parent, acc.id);
  await subscribe(adult);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: {
      quietStart: '08:00',
      quietEnd: '10:00',
      dailyBudget: 1,
      enabledKinds: ['readings_open', 'payment_upcoming'],
    },
  });
  await refresh();
  const db = createWorkerDatabase(world.database.worker);
  await enqueueDeadlineWarnings(db, now);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).not.toHaveBeenCalled();
  await dispatchNotifications(world.database.worker, send, new Date('2026-11-20T05:00:00Z'));
  expect(send).toHaveBeenCalledTimes(1);
  const statuses = (
    await world.database.admin.query(
      "SELECT p.status FROM push_deliveries p JOIN deadline_notifications n ON n.id=p.notification_id WHERE n.warning_at='2026-11-20T04:00:00Z' ORDER BY p.status",
    )
  ).rows;
  expect(statuses).toEqual([{ status: 'sent' }, { status: 'summary' }]);
  await enqueueDeadlineWarnings(db, new Date('2026-11-23T05:00:00Z'));
  await dispatchNotifications(world.database.worker, send, new Date('2026-11-23T05:00:00Z'));
  expect(send).toHaveBeenCalledTimes(1);
});

it('R1a.6c: до создания источника нет прошлых коммунальных наступлений и сводок', async () => {
  const parent = await object();
  await account(parent);
  await meter(parent, null, { nextVerificationOn: '2026-01-01' });
  await world.database.admin.query('SET session_replication_role=replica');
  try {
    await world.database.admin.query("UPDATE deadlines SET created_at='2026-11-20T00:00:00Z'");
  } finally {
    await world.database.admin.query('SET session_replication_role=origin');
  }
  await refresh();
  const items = (await radar()).items;
  expect(items.length).toBeGreaterThan(0);
  expect(items.every((x) => new Date(x.endsAt) >= new Date('2026-11-20T00:00:00Z'))).toBe(true);
  const db = createWorkerDatabase(world.database.worker);
  await enqueueDeadlineWarnings(db, now);
  expect(
    (
      await world.database.admin.query(
        "SELECT n.id FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id WHERE o.ends_at<'2026-11-20T00:00:00Z'",
      )
    ).rows,
  ).toEqual([]);
});
it('R1a.6c: явные пустые warnings сохраняются и выключают предупреждения', async () => {
  const parent = await object();
  await account(parent, {
    readingRule: { ...readingRule, warnings: [], endWarnings: [] },
    paymentRule: { ...paymentRule, warnings: [] },
  });
  await refresh();
  expect(
    (await world.database.admin.query('SELECT warnings_at FROM deadline_occurrences')).rows.every(
      (x) => x.warnings_at.length === 0,
    ),
  ).toBe(true);
  await enqueueDeadlineWarnings(createWorkerDatabase(world.database.worker), now);
  expect((await world.database.admin.query('SELECT id FROM deadline_notifications')).rows).toEqual(
    [],
  );
});
it('R1a.6c: окно без приборов напоминает, закрывается отметкой счёта, отменяется и открывается с прибором', async () => {
  const parent = await object();
  const acc = await account(parent, { paymentRule: null });
  await refresh();
  const window = (await radar()).items.find((x) => x.date === '2026-11-20');
  expect(window).toMatchObject({
    needsMeters: true,
    primaryAction: { hint: 'Добавьте счётчики', completionAction: { kind: 'mark_readings' } },
  });
  const url = `/api/deadlines/occurrences/${window?.id}/complete-readings`;
  expect((await child.post(url, {})).status).toBe(404);
  await subscribe(adult);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00', hideText: false },
  });
  const db = createWorkerDatabase(world.database.worker);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await enqueueDeadlineWarnings(db, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.at(-1)?.[1].text).toBe('Открылось окно показаний. Добавьте счётчики');
  const first = await adult.post(url, {});
  expect(first.status, first.text).toBe(200);
  expect((await adult.post(url, {})).json()).toEqual(first.json());
  await refresh();
  expect((await radar()).items.some((x) => x.id === window?.id)).toBe(false);
  expect((await adult.post(url, { completed: false })).status).toBe(200);
  expect((await radar()).items.some((x) => x.id === window?.id)).toBe(true);
  expect((await adult.post(url, {})).status).toBe(200);
  await meter(parent, acc.id);
  expect((await radar()).items.some((x) => x.id === window?.id)).toBe(true);
  expect((await adult.post(url, {})).json()).toEqual({ code: 'ACTIVE_METERS_EXIST' });
});
it('R1a.6c: конец пустого окна закрывает его и не досылает в сводку', async () => {
  const parent = await object();
  await account(parent, { paymentRule: null });
  await refresh();
  await enqueueDeadlineWarnings(
    createWorkerDatabase(world.database.worker),
    new Date('2026-11-26T04:00:00Z'),
  );
  expect(
    (
      await world.database.admin.query(
        "SELECT n.id FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id WHERE o.date='2026-11-20' AND n.status IN ('pending','summary')",
      )
    ).rows,
  ).toEqual([]);
});
it('R1a.6c: deadline включает только обычные записи', async () => {
  const parent = await object();
  await account(parent);
  const record = await adult.post(`/api/objects/${parent}/deadlines`, {
    rule: { kind: 'date', date: '2026-11-20', time: '09:00', warnings: [0] },
  });
  expect(record.status, record.text).toBe(201);
  await subscribe(adult);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { enabledKinds: ['deadline'], quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100 },
  });
  await refresh();
  await enqueueDeadlineWarnings(createWorkerDatabase(world.database.worker), now);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]?.[1].notificationKind).toBeUndefined();
});
it('R1a.6c: предупреждение до открытия и оба вида в коротком окне не теряются', async () => {
  const parent = await object();
  const acc = await account(parent, {
    paymentRule: null,
    readingRule: {
      ...readingRule,
      repeat: { unit: 'month', day: 20, endDay: 21 },
      warnings: [1, 0],
    },
  });
  await meter(parent, acc.id);
  await subscribe(adult);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100, hideText: false },
  });
  await refresh(new Date('2026-11-19T04:00:00Z'));
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  const db = createWorkerDatabase(world.database.worker);
  for (const date of ['2026-11-19T04:00:00Z', '2026-11-20T04:00:00Z']) {
    await enqueueDeadlineWarnings(db, new Date(date));
    await dispatchNotifications(world.database.worker, send, new Date(date));
  }
  expect(send.mock.calls.map((c) => c[1].text)).toEqual(
    expect.arrayContaining([
      'Скоро откроется окно показаний',
      'Открылось окно показаний',
      'Окно закрывается завтра',
    ]),
  );
  await enqueueDeadlineWarnings(db, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send).toHaveBeenCalledTimes(3);
});
it('R1a.6c: ушедший владелец личного не пополняет очередь отменённых доставок', async () => {
  const parent = await object(true);
  await account(parent);
  await refresh();
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
    [world.houseId, world.boris.id],
  );
  try {
    const db = createWorkerDatabase(world.database.worker);
    await enqueueDeadlineWarnings(db, now);
    await enqueueDeadlineWarnings(db, now);
    expect(
      (await world.database.admin.query('SELECT id FROM deadline_notifications')).rows,
    ).toEqual([]);
  } finally {
    await world.database.admin.query('ALTER TABLE space_members DISABLE TRIGGER USER');
    await world.database.admin.query(
      'UPDATE space_members SET left_at=NULL,left_by=NULL WHERE space_id=$1 AND account_id=$2',
      [world.houseId, world.boris.id],
    );
    await world.database.admin.query('ALTER TABLE space_members ENABLE TRIGGER USER');
  }
});
it('R1a.6c: корзина поверки и передачи возвращает понятные коды без ошибок триггера', async () => {
  const parent = await object();
  const m = await meter(parent, null);
  const r = await read(m.id);
  expect((await adult.post(`/api/readings/${r}/trash`)).status).toBe(200);
  const transmission = await adult.post(`/api/objects/${parent}/readings/transmit`, {
    readingIds: [r],
    method: 'Вымышленный сайт',
  });
  expect(transmission.status).toBe(409);
  expect(transmission.json()).toEqual({ code: 'READING_TRASHED' });
  expect((await adult.post(`/api/meters/${m.id}/trash`)).status).toBe(200);
  const verify = await adult.post(`/api/meters/${m.id}/verify`, { verifiedOn: '2026-11-20' });
  expect(verify.status).toBe(409);
  expect(verify.json()).toEqual({ code: 'METER_TRASHED' });
});
it('R1a.6c: снятие правила на 30 дней не удаляет ручную оплату и её UUID', async () => {
  const parent = await object();
  const acc = await account(parent);
  await refresh();
  const item = (await radar()).items.find(
    (x) => x.sourceKind === 'payment' && x.date === '2026-11-23',
  );
  const paid = await adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`, {});
  expect(paid.status, paid.text).toBe(200);
  expect(
    (
      await adult.request('PATCH', `/api/accounts/${acc.id}`, {
        json: { data: { ...acc.data, paymentRule: null } },
      })
    ).status,
  ).toBe(200);
  await world.database.admin.query('SET session_replication_role=replica');
  try {
    await world.database.admin.query(
      "UPDATE deadlines SET deleted_at=now()-interval '31 days' WHERE source_kind='payment'",
    );
  } finally {
    await world.database.admin.query('SET session_replication_role=origin');
  }
  await refresh();
  const saved = (
    await world.database.admin.query('SELECT completed_at FROM deadline_occurrences WHERE id=$1', [
      item?.id,
    ])
  ).rows[0];
  expect(saved.completed_at.toISOString()).toBe(paid.json<{ completedAt: string }>().completedAt);
  expect(
    (await adult.request('PATCH', `/api/accounts/${acc.id}`, { json: { data: acc.data } })).status,
  ).toBe(200);
  await refresh();
  expect(
    (
      await world.database.admin.query('SELECT id FROM deadline_occurrences WHERE id=$1', [
        item?.id,
      ])
    ).rows,
  ).toHaveLength(1);
});

it('R1a.6c: реальные оплаты после создания источника сохраняются и старше 90 дней', async () => {
  const parent = await object();
  await account(parent, { readingRule: null });
  const client = await world.database.admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL session_replication_role=replica');
    await client.query("UPDATE deadlines SET created_at='2026-06-20T00:00:00Z'");
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  await refresh();
  expect((await radar()).items.map((x) => x.date)).toEqual(
    expect.arrayContaining(['2026-06-23', '2026-11-23']),
  );
});
it('R1a.6c: старое ошибочное невыполненное наступление до создания удаляется при пересчёте', async () => {
  const parent = await object();
  await account(parent, { readingRule: null });
  await world.database.worker.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id)
    SELECT id,'2025-01-23','2025-01-23T00:00:00Z','2025-01-23T23:59:59Z','UTC','[]',space_id,space_kind,audience,author_id,assignee_id FROM deadlines`);
  await refresh();
  expect(
    (
      await world.database.admin.query(
        "SELECT id FROM deadline_occurrences WHERE date='2025-01-23'",
      )
    ).rows,
  ).toEqual([]);
});
