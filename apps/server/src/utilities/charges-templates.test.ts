import { randomBytes, randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { enqueueDeadlineWarnings, refreshDeadlines } from '../deadlines/engine.ts';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let admin: Device;
let child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
afterAll(async () => world?.close());
const place = () => ({ spaceId: world.houseId, audience: 'adults' });
async function apply(extra: Record<string, unknown> = {}, device = adult, id = 'rented_apartment') {
  const body = {
    title: 'Вымышленная сдаваемая квартира',
    placement: place(),
    idempotencyKey: randomUUID(),
    ...extra,
  };
  const response = await device.post(`/api/templates/${id}/apply`, body);
  return { body, response, objectId: response.json<{ objectId: string }>().objectId };
}
it('TPL-1: пустой дом для администратора; ребёнок не получает мастер администратора', async () => {
  expect((await admin.get('/api/onboarding')).json()).toMatchObject({ needsFirstObject: true });
  expect((await child.get('/api/onboarding')).json()).toEqual({
    households: [],
    needsFirstObject: false,
  });
});
it('TPL-2: три каталога, интервалы и предупреждения налога', async () => {
  const response = await adult.get('/api/templates');
  expect(response.status).toBe(200);
  const templates =
    response.json<
      Array<{
        id: string;
        meters: Array<{ data: { verificationYears: number } }>;
        deadlines: Array<{ rule: { warnings: number[] } }>;
      }>
    >();
  expect(templates.map((t) => t.id)).toEqual(['apartment', 'rented_apartment', 'house']);
  expect(templates[0]?.meters.map((m) => m.data.verificationYears)).toEqual([6, 4, 16, 10, 4]);
  expect(templates[0]?.deadlines[0]?.rule.warnings).toEqual([30, 11]);
});
it('TPL-3/S1: ровно выбранные пункты, начальное показание, связь, именованные сроки и повтор', async () => {
  const { body, response, objectId } = await apply({
    accounts: [{ id: 'water_sewerage', data: { number: 'ВЫМ-001', payer: 'tenant' } }],
    meters: [
      {
        id: 'cold_water',
        data: { verifiedOn: '2026-10-01' },
        initialReading: { occurredOn: '2026-10-08', values: ['123,456'] },
      },
    ],
    organizations: ['emergency'],
    deadlines: [{ id: 'tenant_readings' }],
    taxRegime: 'npd',
  });
  expect(response.status, response.text).toBe(201);
  expect((await adult.get(`/api/objects/${objectId}`)).json()).toMatchObject({
    typeData: { status: 'rented' },
  });
  const accounts = (await adult.get(`/api/objects/${objectId}/accounts`)).json<
    Array<{ id: string; data: { number: string } }>
  >();
  expect(accounts).toHaveLength(1);
  expect(accounts[0]?.data.number).toBe('ВЫМ-001');
  const meterRows = (await adult.get(`/api/objects/${objectId}/meters`)).json<
    Array<{ id: string; utilityAccountId: string }>
  >();
  expect(meterRows).toHaveLength(1);
  expect(meterRows[0]?.utilityAccountId).toBe(accounts[0]?.id);
  expect(
    (await adult.get(`/api/meters/${meterRows[0]?.id}/readings`)).json<
      Array<{ values: string[] }>
    >()[0]?.values,
  ).toEqual(['123.456']);
  const db = await world.database.admin.query(
    "SELECT (SELECT count(*)::int FROM record_links WHERE left_id=$1) AS links,(SELECT array_agg(label ORDER BY label) FROM deadlines WHERE object_id=$1 AND source_kind='record') AS labels",
    [objectId],
  );
  expect(db.rows[0]).toEqual({
    links: 1,
    labels: ['Оплатить НПД', 'Получить показания от арендатора'],
  });
  const repeats = await Promise.all([
    adult.post('/api/templates/rented_apartment/apply', body),
    adult.post('/api/templates/rented_apartment/apply', body),
  ]);
  for (const repeat of repeats) expect(repeat.json()).toEqual({ objectId });
  expect((await adult.get(`/api/objects/${objectId}/accounts`)).json()).toHaveLength(1);
  expect(
    (await adult.post('/api/templates/rented_apartment/apply', { ...body, title: 'Другой запрос' }))
      .status,
  ).toBe(409);
  expect((await child.get(`/api/objects/${objectId}/accounts`)).status).toBe(404);
  expect((await admin.get('/api/onboarding')).json()).toMatchObject({ needsFirstObject: false });
});
it('TPL-3: ошибка после создания объекта, организации и счёта откатывает всю транзакцию', async () => {
  const before = await world.database.admin.query(
    'SELECT (SELECT count(*) FROM objects) AS objects,(SELECT count(*) FROM contacts) AS contacts,(SELECT count(*) FROM utility_accounts) AS accounts,(SELECT count(*) FROM template_applications) AS applications',
  );
  const { body, response } = await apply({
    organizations: ['management'],
    accounts: [{ id: 'electricity' }],
    meters: [
      {
        id: 'electricity',
        initialReading: { occurredOn: '2026-10-08', values: ['999999999999999999.9'] },
      },
    ],
  });
  expect(response.status, response.text).toBe(400);
  const after = await world.database.admin.query(
    'SELECT (SELECT count(*) FROM objects) AS objects,(SELECT count(*) FROM contacts) AS contacts,(SELECT count(*) FROM utility_accounts) AS accounts,(SELECT count(*) FROM template_applications) AS applications',
  );
  expect(after.rows).toEqual(before.rows);
  expect(
    (await adult.post('/api/templates/rented_apartment/apply', { ...body, meters: [] })).status,
  ).toBe(201);
});
interface Charge {
  id: string;
  totalCents: number;
  paidCents: number;
  remainingCents: number;
  dueOn: string;
}
async function billing() {
  const { response, objectId } = await apply({ accounts: [{ id: 'electricity' }] });
  expect(response.status, response.text).toBe(201);
  const [account] = (await adult.get(`/api/objects/${objectId}/accounts`)).json<
    Array<{ id: string }>
  >();
  return { objectId, accountId: account?.id as string };
}
async function charge(accountId: string, extra: Record<string, unknown> = {}) {
  const res = await adult.post(`/api/accounts/${accountId}/charges`, {
    period: '2026-10',
    totalCents: 10000,
    ...extra,
  });
  expect(res.status, res.text).toBe(201);
  return res.json<Charge>();
}
async function pay(id: string, amountCents: number) {
  const res = await adult.post(`/api/charges/${id}/payments`, {
    paidOn: '2026-10-08',
    amountCents,
    payer: { kind: 'tenant' },
    method: 'tenant',
  });
  expect(res.status, res.text).toBe(201);
  return res.json<{ id: string }>();
}
async function radar(objectId: string) {
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-08T07:00:00Z'),
    true,
  );
  const res = await adult.get('/api/deadlines?from=2026-10-01&to=2027-01-05');
  expect(res.status, res.text).toBe(200);
  return res
    .json<{
      items: Array<{
        id: string;
        objectId: string;
        chargeId: string | null;
        date: string;
        sourceKind: string;
      }>;
    }>()
    .items.filter((i) => i.objectId === objectId && i.sourceKind === 'payment');
}
it('UTIL-9/10, DEAD-5: перерасчёт, две оплаты, отмена, повтор отмены, история, доступ ребёнка', async () => {
  const { objectId, accountId } = await billing();
  const row = await charge(accountId, {
    lines: [
      { title: 'Электричество', amountCents: 12000 },
      { title: 'Перерасчёт', amountCents: -2000, kind: 'adjustment' },
    ],
  });
  expect(row.dueOn).toBe('2026-11-15');
  let items = await radar(objectId);
  expect(items.filter((i) => i.date === '2026-11-15')).toHaveLength(1);
  expect(items.find((i) => i.date === '2026-11-15')?.chargeId).toBe(row.id);
  const one = await pay(row.id, 4000);
  await pay(row.id, 6000);
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({
    paidCents: 10000,
    remainingCents: 0,
  });
  expect((await radar(objectId)).some((i) => i.chargeId === row.id)).toBe(false);
  const cancel = await adult.post(`/api/payments/${one.id}/cancel`, {
    reason: 'Ошибочная вымышленная оплата',
  });
  expect(cancel.status, cancel.text).toBe(200);
  expect((await adult.post(`/api/payments/${one.id}/cancel`, { reason: 'Повтор' })).json()).toEqual(
    cancel.json(),
  );
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({
    paidCents: 6000,
    remainingCents: 4000,
  });
  expect((await radar(objectId)).some((i) => i.chargeId === row.id)).toBe(true);
  expect((await child.get(`/api/charges/${row.id}`)).status).toBe(404);
  expect((await child.get(`/api/charges/${row.id}/payments`)).status).toBe(404);
  expect((await adult.request('DELETE', `/api/payments/${one.id}`)).status).toBe(409);
  const history = await world.database.admin.query(
    'SELECT changes FROM utility_payments_history WHERE record_id=$1',
    [one.id],
  );
  expect(JSON.stringify(history.rows)).toContain('Ошибочная вымышленная оплата');
  await enqueueDeadlineWarnings(
    createWorkerDatabase(world.database.worker),
    new Date('2026-11-12T04:00:00Z'),
  );
  items = await radar(objectId);
  expect(items.filter((i) => i.date === '2026-11-15')).toHaveLength(1);
});
it('DEAD-4: ручная отметка создаёт ровно остаток, параллельный повтор не дублирует', async () => {
  const { objectId, accountId } = await billing();
  const row = await charge(accountId);
  await pay(row.id, 2500);
  const item = (await radar(objectId)).find((i) => i.chargeId === row.id);
  expect(item).toBeDefined();
  const responses = await Promise.all([
    adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`, {}),
    adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`, {}),
  ]);
  for (const response of responses) expect(response.status, response.text).toBe(200);
  expect((await adult.get(`/api/charges/${row.id}/payments`)).json()).toHaveLength(2);
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({ paidCents: 10000 });
  expect(
    (
      await adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`, {
        completed: false,
      })
    ).status,
  ).toBe(409);
});
it('UTIL-9/10: float, несовпадение строк, посторонний плательщик отклоняются; просроченное начисление появляется', async () => {
  const { objectId, accountId } = await billing();
  for (const totalCents of [1.2, -1, Number.MAX_SAFE_INTEGER + 1])
    expect(
      (await adult.post(`/api/accounts/${accountId}/charges`, { period: '2026-10', totalCents }))
        .status,
    ).toBe(400);
  expect(
    (
      await adult.post(`/api/accounts/${accountId}/charges`, {
        period: '2026-10',
        totalCents: 10,
        lines: [{ title: 'Услуга', amountCents: 11 }],
      })
    ).status,
  ).toBe(400);
  const row = await charge(accountId, { dueOn: '2026-10-01' });
  expect((await radar(objectId)).some((i) => i.chargeId === row.id)).toBe(true);
  expect(
    (
      await adult.post(`/api/charges/${row.id}/payments`, {
        paidOn: '2026-10-08',
        amountCents: 1.5,
        payer: { kind: 'tenant' },
        method: 'cash',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await adult.post(`/api/charges/${row.id}/payments`, {
        paidOn: '2026-10-08',
        amountCents: 100,
        payer: { kind: 'member', accountId: randomUUID() },
        method: 'cash',
      })
    ).status,
  ).toBe(403);
});
it('OBJ-5: корзина и восстановление дерева сохраняют оплаты; перенос в личное', async () => {
  const { objectId, accountId } = await billing();
  const row = await charge(accountId);
  const payment = await pay(row.id, 5000);
  expect((await adult.post(`/api/objects/${objectId}/trash`, {})).status).toBe(200);
  let rows = await world.database.admin.query(
    'SELECT deleted_at FROM utility_payments WHERE id=$1',
    [payment.id],
  );
  expect(rows.rows[0].deleted_at).not.toBeNull();
  const restore = await adult.post(`/api/objects/${objectId}/restore`, {});
  expect(restore.status, restore.text).toBe(200);
  rows = await world.database.admin.query('SELECT deleted_at FROM utility_payments WHERE id=$1', [
    payment.id,
  ]);
  expect(rows.rows[0].deleted_at).toBeNull();
  const move = await adult.post(`/api/objects/${objectId}/personal`, { confirmed: true });
  expect(move.status, move.text).toBe(200);
  rows = await world.database.admin.query('SELECT space_id FROM utility_payments WHERE id=$1', [
    payment.id,
  ]);
  expect(rows.rows[0].space_id).toBe(world.boris.personalSpaceId);
  await pay(row.id, 5000);
  expect((await radar(objectId)).some((i) => i.chargeId === row.id)).toBe(false);
  expect((await adult.post(`/api/objects/${objectId}/trash`, {})).status).toBe(200);
  expect((await adult.post(`/api/objects/${objectId}/restore`, {})).status).toBe(200);
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({ paidCents: 10000 });
  expect((await radar(objectId)).some((i) => i.chargeId === row.id)).toBe(false);
});

it('DEAD-2: явный срок заменяет день счёта; отмена начисления возвращает срок счёта', async () => {
  const { objectId, accountId } = await billing();
  const row = await charge(accountId, { dueOn: '2026-11-20' });
  const before = await radar(objectId);
  expect(before.some((i) => i.date === '2026-11-15')).toBe(false);
  expect(before.find((i) => i.date === '2026-11-20')?.chargeId).toBe(row.id);
  const paid = await pay(row.id, 1);
  expect(
    (await adult.post(`/api/charges/${row.id}/cancel`, { reason: 'Вымышленная ошибка' })).status,
  ).toBe(409);
  await adult.post(`/api/payments/${paid.id}/cancel`, { reason: 'Вымышленная ошибка' });
  const cancelled = await adult.post(`/api/charges/${row.id}/cancel`, {
    reason: 'Вымышленная ошибка',
  });
  expect(cancelled.status, cancelled.text).toBe(200);
  const after = await radar(objectId);
  expect(after.some((i) => i.chargeId === row.id)).toBe(false);
  expect(after.some((i) => i.date === '2026-11-15' && i.chargeId === null)).toBe(true);
});

it('UTIL-9/10: квитанция и чек — только файлы того же объекта, корзина файла скрывает ссылку', async () => {
  const { objectId, accountId } = await billing();
  const file = (
    await world.database.admin.query(
      `INSERT INTO object_files(space_id,space_kind,audience,author_id,title,parent_id,mime_type,size_bytes,storage_key,envelope) VALUES($1,'household','adults',$2,'Вымышленная квитанция.pdf',$3,'application/pdf',8,$4,'{}') RETURNING id`,
      [world.houseId, world.boris.id, objectId, randomUUID()],
    )
  ).rows[0].id;
  const response = await adult.post(`/api/accounts/${accountId}/charges`, {
    period: '2026-10',
    totalCents: 10000,
    receiptId: file,
  });
  expect(response.status, response.text).toBe(201);
  const row = response.json<Charge & { receiptIds: string[] }>();
  expect(row.receiptIds).toEqual([file]);
  const payment = await adult.post(`/api/charges/${row.id}/payments`, {
    paidOn: '2026-10-08',
    amountCents: 10000,
    payer: { kind: 'member', accountId: world.boris.id },
    method: 'card',
    receiptId: file,
  });
  expect(payment.status, payment.text).toBe(201);
  expect(payment.json()).toMatchObject({ receiptIds: [file] });
  const other = await billing();
  expect(
    (
      await adult.post(`/api/accounts/${other.accountId}/charges`, {
        period: '2026-10',
        totalCents: 1,
        receiptId: file,
      })
    ).status,
  ).toBe(404);
  expect((await adult.get(`/api/accounts/${other.accountId}/charges`)).json()).toEqual([]);
  await world.database.admin.query('UPDATE object_files SET deleted_at=now() WHERE id=$1', [file]);
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({ receiptIds: [] });
  await world.database.admin.query('UPDATE object_files SET deleted_at=null WHERE id=$1', [file]);
  expect((await adult.get(`/api/charges/${row.id}`)).json()).toMatchObject({ receiptIds: [file] });
});

it('NOTIF: нет двойной оплаты в очереди; перед отправкой проверяется погашение, отмена возвращает предупреждение', async () => {
  const { objectId, accountId } = await billing();
  const row = await charge(accountId);
  const subscribed = await adult.post('/api/push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString('base64url'),
    },
    deviceName: 'Вымышленный телефон оплаты',
  });
  expect(subscribed.status, subscribed.text).toBe(201);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100 },
  });
  await radar(objectId);
  const worker = createWorkerDatabase(world.database.worker),
    now = new Date('2026-11-12T04:00:00Z');
  await enqueueDeadlineWarnings(worker, now);
  const count = (
    await world.database.admin.query(
      `SELECT count(*)::int AS n FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id JOIN deadlines d ON d.id=o.deadline_id WHERE d.object_id=$1 AND d.source_kind='payment' AND o.date='2026-11-15' AND n.status='pending'`,
      [objectId],
    )
  ).rows[0].n;
  expect(count).toBe(1);
  const paid = await pay(row.id, 10000);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.filter((c) => c[1].recordId === objectId)).toHaveLength(0);
  await adult.post(`/api/payments/${paid.id}/cancel`, {
    reason: 'Ошибочная оплата для проверки предупреждений',
  });
  const due = new Date('2026-11-15T04:00:00Z');
  await enqueueDeadlineWarnings(worker, due);
  await dispatchNotifications(world.database.worker, send, due);
  expect(send.mock.calls.filter((c) => c[1].recordId === objectId)).toHaveLength(1);
  expect(JSON.stringify(world.requestLog)).not.toContain(
    'Ошибочная оплата для проверки предупреждений',
  );
  expect(JSON.stringify(world.requestLog)).not.toContain('Вымышленная сдаваемая квартира');
});
