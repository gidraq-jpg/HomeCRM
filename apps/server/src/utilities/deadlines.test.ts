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
