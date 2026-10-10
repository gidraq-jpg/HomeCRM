import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerDatabase, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import {
  enqueueDeadlineWarnings,
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../deadlines/engine.ts';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import { redactUrl } from '../logging.ts';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device, child: Device, folder: string;
type Task = {
  id: string;
  updatedAt: string;
  doneAt: string | null;
  status: string;
  description: string;
  checklist: { id: string; done: boolean; title: string; position: number }[];
  waitingContactId: string | null;
  planOn: string | null;
  dueOn: string | null;
  assigneeId: string;
};
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-tasks-'));
  world = await createWorld({
    files: { storage: new DirectoryStorage(folder), cipher: new FileCipher(randomBytes(32), 1) },
  });
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
const placement = () => ({ spaceId: world.houseId, audience: 'household' });
async function create(fields: Record<string, unknown> = {}, device = adult) {
  const response = await device.post('/api/tasks', { title: 'Вымышленное дело', ...fields });
  expect(response.status, response.text).toBe(201);
  return response.json<Task>();
}
const patch = (id: string, fields: Record<string, unknown>, device = adult) =>
  device.request('PATCH', `/api/tasks/${id}`, { json: fields });
it('TASK-1: полная карточка, чек-лист, частичная правка не сбрасывает поля, история и конфликт версии', async () => {
  const checklist = [
    { id: randomUUID(), title: 'Первый пункт', done: false, position: 2 },
    { id: randomUUID(), title: 'Второй пункт', done: true, position: 1 },
  ];
  const row = await create({
    description: 'Содержательное описание',
    planOn: '2026-10-15',
    planTime: '18:00',
    dueOn: '2026-10-16',
    checklist,
  });
  const response = await patch(row.id, {
    title: 'Обновлённое вымышленное дело',
    expectedUpdatedAt: row.updatedAt,
    idempotencyKey: randomUUID(),
  });
  expect(response.status, response.text).toBe(200);
  expect(response.json()).toMatchObject({
    description: 'Содержательное описание',
    planOn: '2026-10-15',
    planTime: '18:00',
    checklist,
  });
  const changed = await patch(row.id, { checklist: checklist.map((i) => ({ ...i, done: true })) });
  expect(changed.status, changed.text).toBe(200);
  expect((await adult.get(`/api/tasks/${row.id}/history`)).json<unknown[]>()).toHaveLength(3);
  expect(
    (await patch(row.id, { description: 'Конфликт', expectedUpdatedAt: row.updatedAt })).status,
  ).toBe(409);
});
it('TASK-1/7: конкурентный повтор создания и правки, несовпавший ключ — 409; статусы без двойной истории', async () => {
  const body = { title: 'Повторяемое дело', idempotencyKey: randomUUID() };
  const responses = await Promise.all([
    adult.post('/api/tasks', body),
    adult.post('/api/tasks', body),
  ]);
  for (const r of responses) expect(r.status, r.text).toBe(201);
  const row = responses[0]?.json<Task>();
  if (!row) throw new Error('Missing created task');
  expect(responses[1]?.json().id).toBe(row.id);
  expect((await adult.post('/api/tasks', { ...body, title: 'Другой запрос' })).status).toBe(409);
  const changes = { description: 'Правка с повтором', idempotencyKey: randomUUID() };
  const repeated = await Promise.all([patch(row.id, changes), patch(row.id, changes)]);
  for (const r of repeated) expect(r.status, r.text).toBe(200);
  const status = { status: 'done', idempotencyKey: randomUUID() };
  const finished = await Promise.all([
    adult.post(`/api/tasks/${row.id}/status`, status),
    adult.post(`/api/tasks/${row.id}/status`, status),
  ]);
  for (const r of finished) expect(r.status, r.text).toBe(200);
  const doneAt = finished[0]?.json().doneAt;
  const again = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(again.json().doneAt).toBe(doneAt);
  expect((await adult.get(`/api/tasks/${row.id}/history`)).json<unknown[]>()).toHaveLength(3);
  for (const next of ['open', 'cancelled', 'not_done']) {
    const r = await adult.post(`/api/tasks/${row.id}/status`, { status: next });
    expect(r.status, r.text).toBe(200);
    expect(r.json().doneAt).toBeNull();
  }
});
it('TASK-9: невидящий исполнитель — 409 с признаком расширения; ребёнок правит только назначенное', async () => {
  for (const fields of [
    { assigneeId: world.anna.id },
    { placement: { spaceId: world.houseId, audience: 'adults' }, assigneeId: world.vera.id },
  ]) {
    const response = await adult.post('/api/tasks', { title: 'Недоступное назначение', ...fields });
    expect(response.status, response.text).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'ASSIGNEE_NOT_VISIBLE',
      requiresAudienceExpansion: true,
    });
  }
  const row = await create({ placement: placement(), assigneeId: world.vera.id });
  expect((await patch(row.id, { description: 'Вклад ребёнка' }, child)).status).toBe(200);
  expect((await child.post(`/api/tasks/${row.id}/trash`, {})).status).toBe(403);
  const other = await create({ placement: placement() });
  expect((await patch(other.id, { title: 'Чужая правка' }, child)).status).toBe(403);
  expect((await patch(row.id, { assigneeId: world.anna.id }, child)).status).toBe(403);
  expect(
    (
      await adult.post(`/api/tasks/${row.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(403);
});
it('TASK-1: личное и «Взрослые» скрыты в карточке, списке, поиске и истории', async () => {
  const privateTask = await create({
    title: 'Личное контрольное',
    description: 'тайный контрольный текст',
  });
  const adults = await create({
    title: 'Взрослое контрольное',
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  for (const viewer of [admin, child]) {
    expect((await viewer.get(`/api/tasks/${privateTask.id}`)).status).toBe(404);
    expect((await viewer.get(`/api/tasks/${privateTask.id}/history`)).status).toBe(404);
    expect((await viewer.get('/api/tasks')).text).not.toContain(privateTask.id);
    expect((await viewer.get('/api/search?q=контроль')).text).not.toContain(privateTask.id);
  }
  expect((await child.get(`/api/tasks/${adults.id}`)).status).toBe(404);
  expect((await child.get('/api/search?q=контроль')).text).not.toContain(adults.id);
  expect((await adult.get('/api/search?q=контроль')).text).toContain(privateTask.id);
});
it('TASK-1/8: жду в радаре и очереди, закрытие и возврат, перенос и корзина меняют доступ сразу', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const row = await create({ status: 'waiting', waitingAccountId: world.anna.id, checkOn: date });
  const worker = createWorkerDatabase(world.database.worker);
  const now = new Date(`${date}T05:00:00Z`);
  await refreshDeadlines(worker, now, true);
  await enqueueDeadlineWarnings(worker, now);
  const url = `/api/deadlines?from=${date}&to=${date}`;
  const radar = await adult.get(url);
  expect(radar.status, radar.text).toBe(200);
  expect(
    radar.json<{ items: { taskId: string }[] }>().items.find((i) => i.taskId === row.id),
  ).toMatchObject({
    sourceKind: 'task_waiting',
    date,
    warningsAt: [`${date}T04:00:00.000Z`],
  });
  expect((await admin.get(url)).text).not.toContain(row.id);
  expect(
    (
      await world.database.admin.query(
        'SELECT n.id FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id JOIN deadlines d ON d.id=o.deadline_id WHERE d.task_id=$1 AND n.recipient_id=$2',
        [row.id, world.boris.id],
      )
    ).rowCount,
  ).toBe(1);
  const finished = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(finished.status, finished.text).toBe(200);
  expect((await adult.get(url)).text).not.toContain(row.id);
  const back = await adult.post(`/api/tasks/${row.id}/status`, { status: 'waiting' });
  expect(back.status, back.text).toBe(200);
  await refreshDeadlines(worker, now, true);
  expect((await adult.get(url)).text).toContain(row.id);
  expect(
    (await adult.post(`/api/tasks/${row.id}/move`, { ...placement(), confirmed: true })).status,
  ).toBe(200);
  expect((await child.get(url)).text).toContain(row.id);
  expect(
    (
      await adult.post(`/api/tasks/${row.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await child.get(url)).text).not.toContain(row.id);
  expect((await adult.post(`/api/tasks/${row.id}/trash`, {})).status).toBe(200);
  expect((await adult.get(url)).text).not.toContain(row.id);
  expect((await adult.get('/api/tasks?trash=true')).text).toContain(row.id);
  expect((await adult.post(`/api/tasks/${row.id}/restore`, {})).status).toBe(200);
  expect((await adult.get(url)).text).toContain(row.id);
});
it('TASK-1: фильтры моё, назначил другим, без даты, жду, статус и объект; связи сохраняются при правке', async () => {
  const obj = (await adult.post('/api/objects', { title: 'Вымышленный объект дела' })).json<{
    id: string;
  }>();
  const row = await create({ objectId: obj.id, planOn: '2026-10-15' });
  expect(
    (await adult.get(`/api/tasks?objectId=${obj.id}`)).json<Task[]>().map((t) => t.id),
  ).toEqual([row.id]);
  const links = (await adult.get(`/api/records/task/${row.id}/links`)).json<unknown[]>();
  expect(links).toHaveLength(1);
  await patch(row.id, { title: 'Правка со связью' });
  expect(
    (await adult.get(`/api/records/task/${row.id}/links`))
      .json<{ id: string }[]>()
      .map((l) => l.id),
  ).toEqual((links as { id: string }[]).map((l) => l.id));
  const assigned = await create({ placement: placement(), assigneeId: world.vera.id });
  expect((await adult.get('/api/tasks?filter=assigned')).json<Task[]>().map((t) => t.id)).toContain(
    assigned.id,
  );
  expect((await child.get('/api/tasks?filter=mine')).json<Task[]>().map((t) => t.id)).toContain(
    assigned.id,
  );
  expect(
    (await adult.get('/api/tasks?filter=undated')).json<Task[]>().map((t) => t.id),
  ).not.toContain(row.id);
  expect(
    (await adult.get('/api/tasks?status=done')).json<Task[]>().every((t) => t.status === 'done'),
  ).toBe(true);
  expect(
    (await adult.get('/api/tasks?filter=waiting'))
      .json<Task[]>()
      .every((t) => t.status === 'waiting'),
  ).toBe(true);
});
it('TASK-1: скрытая связь и скрытый контакт ожидания не стираются правкой другого взрослого', async () => {
  const contact = (
    await adult.post('/api/contacts', { title: 'Личный контакт дела', kind: 'person', data: {} })
  ).json<{ id: string }>();
  const obj = (await adult.post('/api/objects', { title: 'Личный объект дела' })).json<{
    id: string;
  }>();
  const row = await create({
    placement: placement(),
    status: 'waiting',
    waitingContactId: contact.id,
    checkOn: '2026-10-20',
    links: [{ type: 'object', id: obj.id }],
  });
  const card = (await admin.get(`/api/tasks/${row.id}`)).json<Task>();
  expect(card.waitingContactId).toBeNull();
  expect((await admin.get(`/api/records/task/${row.id}/links`)).json()).toEqual([]);
  const r = await patch(
    row.id,
    { title: 'Правка без скрытых ссылок', waitingContactId: null },
    admin,
  );
  expect(r.status, r.text).toBe(200);
  expect((await adult.get(`/api/tasks/${row.id}`)).json().waitingContactId).toBe(contact.id);
  expect((await adult.get(`/api/records/task/${row.id}/links`)).json<unknown[]>()).toHaveLength(1);
});
it('TASK-8: окончательная очистка контакта сохраняет дело и допускает дальнейшую правку', async () => {
  const contact = (
    await adult.post('/api/contacts', {
      title: 'Прежний адресат ожидания',
      kind: 'person',
      data: {},
    })
  ).json<{ id: string }>();
  const row = await create({
    status: 'waiting',
    waitingContactId: contact.id,
    checkOn: '2026-10-20',
  });
  await adult.post(`/api/contacts/${contact.id}/trash`, {});
  // Старую дату ставит только тестовая административная роль, имитируя 31 день хранения.
  const connection = await world.database.admin.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('ALTER TABLE contacts DISABLE TRIGGER contacts_trash_time');
    await connection.query("UPDATE contacts SET deleted_at=now()-interval '31 days' WHERE id=$1", [
      contact.id,
    ]);
    await connection.query('ALTER TABLE contacts ENABLE TRIGGER contacts_trash_time');
    await connection.query('COMMIT');
  } finally {
    await connection.query('ROLLBACK');
    connection.release();
  }
  expect(
    (await world.database.worker.query('DELETE FROM contacts WHERE id=$1', [contact.id])).rowCount,
  ).toBe(1);
  const updated = await patch(row.id, { description: 'Адресат удалён, история дела сохранена' });
  expect(updated.status, updated.text).toBe(200);
  expect(updated.json<Task>().waitingContactId).toBeNull();
  expect(updated.json<Task>().status).toBe('waiting');
});
it('TASK-1: файлы зашифрованы, следуют переносу и корзине, ребёнок загружает в своё назначенное дело', async () => {
  const row = await create();
  const upload = async (id: string, device = adult) =>
    world.app.inject({
      method: 'POST',
      url: `/api/tasks/${id}/files`,
      headers: {
        cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: BASE_URL,
        'content-type': 'multipart/form-data; boundary=TasksBoundary',
      },
      payload: Buffer.from(
        '--TasksBoundary\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\nfictional\n%%EOF\r\n--TasksBoundary--\r\n',
      ),
    });
  const response = await upload(row.id);
  expect(response.statusCode, response.body).toBe(201);
  const file = response.json();
  expect(JSON.stringify(file)).not.toMatch(/envelope|storageKey/);
  expect((await adult.get(`/api/tasks/${row.id}/files`)).json<unknown[]>()).toHaveLength(1);
  expect((await admin.get(`/api/files/${file.id}`)).status).toBe(404);
  expect(
    (await adult.post(`/api/tasks/${row.id}/move`, { ...placement(), confirmed: true })).status,
  ).toBe(200);
  expect((await admin.get(`/api/files/${file.id}`)).status).toBe(200);
  await adult.post(`/api/tasks/${row.id}/trash`, {});
  const removed = (
    await world.database.admin.query('SELECT deleted_at FROM task_files WHERE id=$1', [file.id])
  ).rows[0]?.deleted_at;
  expect(removed).not.toBeNull();
  await adult.post(`/api/tasks/${row.id}/restore`, {});
  expect(
    (await world.database.admin.query('SELECT deleted_at FROM task_files WHERE id=$1', [file.id]))
      .rows[0]?.deleted_at,
  ).toBeNull();
  const own = await create({ placement: placement(), assigneeId: world.vera.id });
  const childFile = await upload(own.id, child);
  expect(childFile.statusCode, childFile.body).toBe(201);
});
it('TASK-1: входные даты, время, чек-лист и ожидание проверяются; журнал скрывает фильтры и текст', async () => {
  for (const data of [
    { planTime: '09:00' },
    { planOn: '2026-02-31' },
    { dueOn: '2026-10-10', dueTime: '24:00' },
    { status: 'waiting' },
    { status: 'waiting', checkOn: '2026-10-15' },
    { checklist: [{ id: randomUUID(), title: '', done: false, position: 0 }] },
  ])
    expect((await adult.post('/api/tasks', { title: 'Невалидное дело', ...data })).status).toBe(
      400,
    );
  expect(redactUrl('/api/tasks?title=секрет&filter=waiting')).toBe('/api/tasks');
  expect(redactUrl('/api/tasks/тайное/status?text=секрет')).toBe('/api/tasks/[redacted]/status');
  expect(world.requestLog.join('\n')).not.toContain('Вымышленное дело');
});
it('TASK-8: push скрывает текст, повтор не дублируется, закрытое ожидание отменяет отправку', async () => {
  await world.database.admin.query('DELETE FROM deadline_notifications');
  const subscription = await adult.post('/api/push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
    keys: {
      p256dh: webpush.generateVAPIDKeys().publicKey,
      auth: randomBytes(16).toString('base64url'),
    },
    deviceName: 'Вымышленный телефон дела',
  });
  expect(subscription.status, subscription.text).toBe(201);
  await adult.request('PATCH', '/api/notifications/settings', {
    json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100, hideText: true },
  });
  const date = new Date().toISOString().slice(0, 10),
    now = new Date(`${date}T05:00:00Z`),
    worker = createWorkerDatabase(world.database.worker);
  const row = await create({ status: 'waiting', waitingAccountId: world.anna.id, checkOn: date });
  await refreshDeadlines(worker, now, true);
  await enqueueDeadlineWarnings(worker, now);
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.filter((call) => call[1].recordId === row.id)).toHaveLength(1);
  expect(send.mock.calls.find((call) => call[1].recordId === row.id)?.[1].text).toBe(
    'В HomeCRM есть новое',
  );
  await enqueueDeadlineWarnings(worker, now);
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.filter((call) => call[1].recordId === row.id)).toHaveLength(1);
  const closed = await create({
    status: 'waiting',
    waitingAccountId: world.anna.id,
    checkOn: date,
  });
  await refreshDeadlines(worker, now, true);
  await enqueueDeadlineWarnings(worker, now);
  await adult.post(`/api/tasks/${closed.id}/status`, { status: 'done' });
  await dispatchNotifications(world.database.worker, send, now);
  expect(send.mock.calls.some((call) => call[1].recordId === closed.id)).toBe(false);
  const visible = await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.execute(sql`SELECT d.task_id FROM deadlines d WHERE d.task_id=${row.id}::uuid`),
  );
  expect(visible.rowCount).toBe(1);
});
