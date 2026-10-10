import { randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { initializeHouseTimeZones, refreshDeadlines } from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => world?.close());
async function billing() {
  const object = (
    await adult.post('/api/objects', {
      title: 'Вымышленный объект API',
      objectType: 'property',
      placement: { spaceId: world.houseId, audience: 'adults' },
    })
  ).json<{ id: string }>();
  const account = await adult.post(`/api/objects/${object.id}/accounts`, {
    title: 'Вымышленный счёт API',
  });
  expect(account.status, account.text).toBe(201);
  return { objectId: object.id, accountId: account.json<{ id: string }>().id };
}
it('API: начисление и оплата с ключом повторяются без дублей; иной запрос с тем же ключом — 409', async () => {
  const { accountId } = await billing();
  const body = {
    period: '2026-10',
    totalCents: 10000,
    dueOn: '2026-10-10',
    idempotencyKey: randomUUID(),
  };
  const [a, b] = await Promise.all([
    adult.post(`/api/accounts/${accountId}/charges`, body),
    adult.post(`/api/accounts/${accountId}/charges`, body),
  ]);
  expect(a.status, a.text).toBe(201);
  expect(b.status, b.text).toBe(201);
  const chargeId = a.json<{ id: string }>().id;
  expect(b.json().id).toBe(chargeId);
  expect(
    (await adult.post(`/api/accounts/${accountId}/charges`, { ...body, totalCents: 10001 })).status,
  ).toBe(409);
  const payment = {
    paidOn: '2026-10-09',
    amountCents: 4000,
    payer: { kind: 'member', accountId: world.boris.id },
    method: 'card',
    idempotencyKey: randomUUID(),
  };
  const [p, q] = await Promise.all([
    adult.post(`/api/charges/${chargeId}/payments`, payment),
    adult.post(`/api/charges/${chargeId}/payments`, payment),
  ]);
  expect(p.status, p.text).toBe(201);
  expect(q.status, q.text).toBe(201);
  expect(p.json().id).toBe(q.json().id);
  expect((await adult.get(`/api/charges/${chargeId}`)).json()).toMatchObject({
    paidCents: 4000,
    remainingCents: 6000,
  });
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-09T05:00:00Z'),
    true,
  );
  const radar = (await adult.get('/api/deadlines?from=2026-10-01&to=2027-10-02')).json<{
    items: { id: string; chargeId: string; totalCents: number; remainingCents: number }[];
  }>();
  const item = radar.items.find((i) => i.chargeId === chargeId);
  expect(item).toMatchObject({ totalCents: 10000, remainingCents: 6000 });
  const completed = await adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`);
  expect(completed.status, completed.text).toBe(200);
  expect(completed.json<{ paymentId: string }>().paymentId).toBeTruthy();
  const repeated = await adult.post(`/api/deadlines/occurrences/${item?.id}/complete-payment`);
  expect(repeated.json()).toMatchObject({ paymentId: null });
  expect((await adult.get(`/api/charges/${chargeId}/payments`)).json<unknown[]>()).toHaveLength(2);
  const month = (await adult.get('/api/utilities/month?month=2026-10')).json<{
    objects: { spaceId: string; spaceKind: string; audience: string }[];
  }>();
  expect(month.objects).toContainEqual(
    expect.objectContaining({ spaceId: world.houseId, spaceKind: 'household', audience: 'adults' }),
  );
});
it('API: документы возвращают названия владельцев, карточка — живые файлы; скрытый контакт не раскрывается', async () => {
  const { objectId } = await billing();
  const own = await adult.post('/api/documents', {
    title: 'Вымышленный документ объекта API',
    owner: { kind: 'object', id: objectId },
  });
  expect(own.status, own.text).toBe(201);
  const docId = own.json<{ id: string }>().id;
  expect(own.json()).toMatchObject({
    objectTitle: 'Вымышленный объект API',
    ownerContactTitle: null,
  });
  const fileId = randomUUID();
  await world.database.admin.query(
    `INSERT INTO document_files(id,space_id,space_kind,audience,author_id,title,parent_id,mime_type,size_bytes,storage_key,envelope)
    VALUES($1,$2,'household','adults',$3,'Вымышленный файл.pdf',$4,'application/pdf',8,$5,'{}')`,
    [fileId, world.houseId, world.boris.id, docId, randomUUID()],
  );
  expect((await adult.get(`/api/documents/${docId}`)).json()).toMatchObject({
    files: [{ id: fileId, name: 'Вымышленный файл.pdf' }],
  });
  const contact = (
    await adult.post('/api/contacts', {
      title: 'Вымышленный владелец API',
      kind: 'person',
      placement: { spaceId: world.houseId, audience: 'household' },
    })
  ).json<{ id: string }>();
  const doc = await adult.post('/api/documents', {
    title: 'Вымышленный документ контакта API',
    owner: { kind: 'contact', id: contact.id },
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(doc.status, doc.text).toBe(201);
  expect(doc.json()).toMatchObject({ ownerContactTitle: 'Вымышленный владелец API' });
  const moved = await adult.post(`/api/contacts/${contact.id}/move`, {
    spaceId: world.houseId,
    audience: 'adults',
    confirmed: true,
  });
  expect(moved.status, moved.text).toBe(200);
  const hidden = await child.get(`/api/documents/${doc.json<{ id: string }>().id}`);
  expect(hidden.status, hidden.text).toBe(200);
  expect(hidden.json()).toMatchObject({ ownerContactTitle: null, owner: null });
  expect(hidden.text).not.toContain(contact.id);
});
it('API: сервер обрезает обычные сроки на 90 дней, документы — 365 и начатое предупреждение; совместим с to+366', async () => {
  const note = (await adult.post('/api/notes', { title: 'Вымышленная заметка горизонта' })).json<{
    id: string;
  }>();
  const near = await adult.post(`/api/notes/${note.id}/deadlines`, {
    rule: { kind: 'date', date: '2027-02-10' },
  });
  expect(near.status, near.text).toBe(201);
  const doc = (
    await adult.post('/api/documents', {
      title: 'Вымышленный далёкий документ',
      data: { type: 'international_passport', expiresOn: '2027-03-01' },
    })
  ).json<{ id: string }>();
  const noWarning = (
    await adult.post('/api/documents', {
      title: 'Вымышленный документ без предупреждения',
      data: { type: 'other', expiresOn: '2027-03-01', warnings: [] },
    })
  ).json<{ id: string }>();
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-09T05:00:00Z'),
    true,
  );
  const r = await adult.get('/api/deadlines?from=2026-10-09&to=2099-12-31');
  expect(r.status, r.text).toBe(200);
  expect(r.text).not.toContain(near.json<{ id: string }>().id);
  expect(r.text).toContain(doc.id);
  expect(r.text).not.toContain(noWarning.id);
});
