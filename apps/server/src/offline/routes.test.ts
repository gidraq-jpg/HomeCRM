import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OperationReceipt } from '@homecrm/shared';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { FileCipher } from '../files/crypto.ts';
import { DirectoryStorage } from '../files/storage.ts';
import * as idempotency from '../idempotency.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World,
  adult: Device,
  other: Device,
  child: Device,
  admin: Device,
  folder: string,
  photo: Buffer;
let TaskCard: { safeParse(value: unknown): { success: boolean } };
type Card = {
  id: string;
  updatedAt: string;
  title: string;
  receipt: OperationReceipt;
  checklist: { id: string; title: string; done: boolean; position: number }[];
  completionEventId: string | null;
  nextTaskId: string | null;
};
type Snapshot<T = Card> = {
  accountId: string;
  data: T;
  versions: { id: string; version: string }[];
};
beforeAll(async () => {
  // Настоящая схема старого клиента; серверный tsc не включает браузерные исходники.
  const legacyModule = new URL('../../../web/src/tasks/api.ts', import.meta.url).href;
  TaskCard = (await import(legacyModule)).TaskCard;
  folder = await mkdtemp(join(tmpdir(), 'homecrm-offline-'));
  world = await createWorld({
    files: { storage: new DirectoryStorage(folder), cipher: new FileCipher(randomBytes(32), 1) },
  });
  adult = world.device();
  other = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await other.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  photo = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#123456' } })
    .png()
    .toBuffer();
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await world?.close();
  if (folder) await rm(folder, { recursive: true, force: true });
});
const place = () => ({ spaceId: world.houseId, audience: 'household' });
const patch = (type: string, id: string, body: unknown, device = adult) =>
  device.request('PATCH', `/api/${type}/${id}`, { json: body });
async function snapshot<T = Card>(url: string): Promise<Snapshot<T>> {
  const response = await adult.get(`${url}${url.includes('?') ? '&' : '?'}offline=true`);
  expect(response.status, response.text).toBe(200);
  expect(response.json<Snapshot<T>>().accountId).toBe(world.boris.id);
  return response.json<Snapshot<T>>();
}
/** Настоящий COMMIT завершён; теряется именно ответ успешной транзакции. */
async function loseCommittedReply(
  key: string,
  send: () => Promise<{ status: number; text: string } | { statusCode: number; body: string }>,
) {
  const original = world.module.appDb.withAccount.bind(world.module.appDb);
  let lost = false;
  const spy = vi
    .spyOn(world.module.appDb, 'withAccount')
    .mockImplementation(async (accountId, fn, options) => {
      const result = await original(accountId, fn, options);
      const candidate = (Array.isArray(result) ? result[0] : result) as
        | { receipt?: { key?: string } }
        | undefined;
      if (!lost && candidate?.receipt?.key === key) {
        lost = true;
        throw new Error('Committed response lost');
      }
      return result;
    });
  const response = await send();
  spy.mockRestore();
  expect('status' in response ? response.status : response.statusCode).toBe(500);
  expect(lost).toBe(true);
  expect(
    (await world.database.admin.query('SELECT key FROM api_operations WHERE key=$1', [key])).rows,
  ).toHaveLength(1);
}
async function object() {
  const response = await adult.post('/api/objects', {
    title: 'Вымышленный объект офлайн',
    placement: place(),
  });
  expect(response.status, response.text).toBe(201);
  return response.json<Card>();
}
async function meter(parent: string, initial = false) {
  const response = await adult.post(`/api/objects/${parent}/meters`, {
    data: { resource: 'cold_water' },
    ...(initial ? { initialReading: { occurredOn: '2026-09-20', values: ['100.000'] } } : {}),
  });
  expect(response.status, response.text).toBe(201);
  return response.json<Card>();
}
async function upload(parent: string, key: string, version: string, bytes = photo, device = adult) {
  const boundary = 'OfflinePhotoBoundary';
  return world.app.inject({
    method: 'POST',
    url: `/api/objects/${parent}/files`,
    remoteAddress: device.ip,
    headers: {
      cookie: [...device.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: BASE_URL,
      'user-agent': device.userAgent,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'idempotency-key': key,
      'x-offline': 'true',
      'x-owner-account-id': world.boris.id,
      'x-expected-updated-at': version,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fiction.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}
it('R1c.8: lost COMMIT create → edit → complete, точная квитанция не заменяется текущей чужой версией', async () => {
  const body = {
    title: 'Дело цепочки',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    clientActedAt: '2026-10-10T01:00:00Z',
  };
  await loseCommittedReply(body.idempotencyKey, () => adult.post('/api/tasks', body));
  const repeated = await other.post('/api/tasks', body);
  expect(repeated.status, repeated.text).toBe(201);
  const created = repeated.json<Card>();
  OperationReceipt.parse(created.receipt);
  const changes = {
    description: 'Первая локальная правка',
    expectedUpdatedAt: created.receipt.results[0]?.updatedAt,
    idempotencyKey: randomUUID(),
    offline: true,
    ownerAccountId: world.boris.id,
  };
  await loseCommittedReply(changes.idempotencyKey, () => patch('tasks', created.id, changes));
  const edited = (await patch('tasks', created.id, changes)).json<Card>();
  const done = {
    status: 'done',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: edited.receipt.results[0]?.updatedAt,
  };
  await loseCommittedReply(done.idempotencyKey, () =>
    adult.post(`/api/tasks/${created.id}/status`, done),
  );
  const complete = (await adult.post(`/api/tasks/${created.id}/status`, done)).json<Card>();
  expect(complete.completionEventId).toBeTruthy();
  await patch('tasks', created.id, { title: 'Правка другого устройства' }, other);
  const retry = (await other.post('/api/tasks', body)).json<Card>();
  expect(retry.title).toBe('Правка другого устройства');
  expect(retry.receipt).toEqual(created.receipt);
  const stale = await patch('tasks', created.id, {
    ...changes,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: created.receipt.results[0]?.updatedAt,
  });
  expect(stale.status).toBe(409);
  expect(stale.json().code).toBe('STALE_VERSION');
  expect((await adult.post('/api/tasks', { ...body, title: 'Другие данные' })).json().code).toBe(
    'IDEMPOTENCY_CONFLICT',
  );
  expect(
    (
      await adult.post('/api/tasks', { title: body.title, idempotencyKey: body.idempotencyKey })
    ).json().code,
  ).toBe('IDEMPOTENCY_CONFLICT');
});
it('R1c.8: прежние keyed online вызовы проходят настоящий strict TaskCard и сохраняют старые хэши', async () => {
  const body = { title: 'Прежний сетевой контракт', idempotencyKey: randomUUID() };
  const created = await adult.post('/api/tasks', body);
  expect(created.status).toBe(201);
  expect(TaskCard.safeParse(created.json()).success).toBe(true);
  expect(created.json().receipt).toBeUndefined();
  const card = created.json<Card>();
  const changes = {
    title: 'Прежняя правка',
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: card.updatedAt,
  };
  const edited = await patch('tasks', card.id, changes);
  expect(edited.status, edited.text).toBe(200);
  expect(TaskCard.safeParse(edited.json()).success).toBe(true);
  const status = {
    status: 'done',
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: edited.json<Card>().updatedAt,
  };
  const finished = await adult.post(`/api/tasks/${card.id}/status`, status);
  expect(TaskCard.safeParse(finished.json()).success).toBe(true);
  for (const key of [body.idempotencyKey, changes.idempotencyKey, status.idempotencyKey])
    await world.database.admin.query('UPDATE api_operations SET receipt=NULL WHERE key=$1', [key]);
  for (const response of [
    await adult.post('/api/tasks', body),
    await patch('tasks', card.id, changes),
    await adult.post(`/api/tasks/${card.id}/status`, status),
  ]) {
    expect(response.status, response.text).toBeLessThan(300);
    expect(TaskCard.safeParse(response.json()).success).toBe(true);
  }
});
it('R1c.8: data и version одного снимка при конкурентной правке между чтением и квитанцией версии', async () => {
  const created = (
    await adult.post('/api/tasks', { title: 'Снимок до чужой правки' })
  ).json<Card>();
  const before = await snapshot(`/api/tasks/${created.id}`);
  const original = idempotency.recordVersions;
  let changed = false;
  vi.spyOn(idempotency, 'recordVersions').mockImplementation(async (tx, table, ids) => {
    if (!changed && table === 'tasks' && ids.includes(created.id)) {
      changed = true;
      const response = await patch('tasks', created.id, { title: 'После чужой правки' }, other);
      expect(response.status).toBe(200);
    }
    return original(tx, table, ids);
  });
  const concurrent = await snapshot(`/api/tasks/${created.id}`);
  expect(changed).toBe(true);
  expect(concurrent.data.title).toBe(before.data.title);
  expect(concurrent.versions).toEqual(before.versions);
  const stale = await patch('tasks', created.id, {
    title: 'Устаревший ввод',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: concurrent.versions[0]?.version,
  });
  expect(stale.json().code).toBe('STALE_VERSION');
});
it('R1c.8: две ревизии в одной миллисекунде конфликтуют; legacy milliseconds остаются совместимы', async () => {
  const row = (await adult.post('/api/tasks', { title: 'Проверка микросекунд' })).json<Card>();
  const changeVersion = async (version: string) => {
    const connection = await world.database.admin.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('ALTER TABLE tasks DISABLE TRIGGER tasks_guard');
      await connection.query('UPDATE tasks SET updated_at=$1 WHERE id=$2', [version, row.id]);
      await connection.query('ALTER TABLE tasks ENABLE TRIGGER tasks_guard');
      await connection.query('COMMIT');
    } finally {
      connection.release();
    }
  };
  await changeVersion('2030-01-01T01:00:00.123456Z');
  const before = await snapshot(`/api/tasks/${row.id}`);
  await changeVersion('2030-01-01T01:00:00.123789Z');
  expect((await adult.get(`/api/tasks/${row.id}`)).json<Card>().updatedAt).toBe(
    before.data.updatedAt,
  );
  const stale = await patch('tasks', row.id, {
    title: 'Тихая перезапись',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: before.versions[0]?.version,
  });
  expect(stale.json().code).toBe('STALE_VERSION');
  expect(
    (
      await patch('tasks', row.id, {
        title: 'Сетевой клиент',
        expectedUpdatedAt: before.data.updatedAt,
        idempotencyKey: randomUUID(),
      })
    ).status,
  ).toBe(200);
});
it('R1c.8: note create/checklist/patch lost COMMIT, clientId→UUID, конкурентный повтор и личный пункт меняет базу', async () => {
  const local = randomUUID(),
    body = {
      title: 'Заметка с локальным пунктом',
      offline: true,
      ownerAccountId: world.boris.id,
      idempotencyKey: randomUUID(),
      checklist: [{ clientId: local, title: 'Вымышленный пункт' }],
    };
  await loseCommittedReply(body.idempotencyKey, () => adult.post('/api/notes', body));
  const responses = await Promise.all([
    adult.post('/api/notes', body),
    other.post('/api/notes', body),
  ]);
  expect(responses.every((r) => r.status === 201)).toBe(true);
  const note = responses[0]?.json<Card>();
  if (!note) throw new Error('Missing note');
  expect(responses[1]?.json<Card>().id).toBe(note.id);
  expect(note.receipt.checklist?.[0]).toMatchObject({ clientId: local, id: note.checklist[0]?.id });
  const changes = {
    checklist: note.checklist.map((i) => ({ id: i.id, title: i.title, done: true })),
    expectedUpdatedAt: note.receipt.results[0]?.updatedAt,
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
  };
  await loseCommittedReply(changes.idempotencyKey, () => patch('notes', note.id, changes));
  const after = (await patch('notes', note.id, changes)).json<Card>();
  expect(after.checklist[0]?.done).toBe(true);
  const snap = await snapshot(`/api/notes/${note.id}`);
  await world.module.appDb.withAccount(world.boris.id, async (tx) => {
    await tx.execute(
      (await import('@homecrm/db'))
        .sql`UPDATE note_items SET done=false WHERE id=${note.checklist[0]?.id}::uuid`,
    );
  });
  const current = await snapshot(`/api/notes/${note.id}`);
  expect(current.versions[0]?.version).not.toBe(snap.versions[0]?.version);
  expect(
    (
      await patch('notes', note.id, {
        ...changes,
        idempotencyKey: randomUUID(),
        expectedUpdatedAt: snap.versions[0]?.version,
      })
    ).json().code,
  ).toBe('STALE_VERSION');
  expect(
    (await world.database.admin.query('SELECT id FROM notes_history WHERE record_id=$1', [note.id]))
      .rows,
  ).toEqual([]);
  expect((await patch('notes', note.id, { ...changes, assigneeId: world.anna.id })).status).toBe(
    400,
  );
});
it('R1c.8: task checklist находится в версии строки; обновление другого устройства конфликтует', async () => {
  const body = {
    title: 'Дело со списком',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    checklist: [{ id: randomUUID(), title: 'Пункт', done: false, position: 0 }],
  };
  const row = (await adult.post('/api/tasks', body)).json<Card>();
  const snap = await snapshot(`/api/tasks/${row.id}`);
  await patch(
    'tasks',
    row.id,
    { checklist: body.checklist.map((i) => ({ ...i, done: true })) },
    other,
  );
  const stale = await patch('tasks', row.id, {
    checklist: body.checklist,
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: snap.versions[0]?.version,
  });
  expect(stale.json().code).toBe('STALE_VERSION');
});
it('R1c.8: фото → показание с lost COMMIT/параллельным повтором, иной byte/key/parent и сохранные блоки', async () => {
  const parent = await object(),
    readingMeter = await meter(parent.id);
  const snap = await snapshot(`/api/objects/${parent.id}`),
    key = randomUUID(),
    base = snap.versions[0]?.version ?? '';
  await loseCommittedReply(key, () => upload(parent.id, key, base));
  const uploads = await Promise.all([upload(parent.id, key, base), upload(parent.id, key, base)]);
  expect(uploads.every((r) => r.statusCode === 201)).toBe(true);
  const file = uploads[0]?.json<Card>();
  if (!file) throw new Error('Missing file');
  expect(uploads[1]?.json().id).toBe(file.id);
  expect(await readdir(folder)).toHaveLength(2);
  const bytes = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#abcdef' },
  })
    .png()
    .toBuffer();
  expect((await upload(parent.id, key, base, bytes)).json().code).toBe('IDEMPOTENCY_CONFLICT');
  const otherObject = await object();
  expect((await upload(otherObject.id, key, base)).json().code).toBe('IDEMPOTENCY_CONFLICT');
  const meterSnap = await snapshot(`/api/meters/${readingMeter.id}`);
  const reading = {
    occurredOn: '2026-10-20',
    values: ['100,125'],
    photoIds: [file.id],
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: meterSnap.versions[0]?.version,
    expectedLatestReadingId: null,
  };
  await loseCommittedReply(reading.idempotencyKey, () =>
    adult.post(`/api/meters/${readingMeter.id}/readings`, reading),
  );
  const repeated = await adult.post(`/api/meters/${readingMeter.id}/readings`, reading);
  expect(repeated.status, repeated.text).toBe(201);
  expect(repeated.json()).toMatchObject({
    values: ['100.125'],
    photoIds: [file.id],
    takenBy: world.boris.id,
  });
  expect(
    (await adult.get(`/api/meters/${readingMeter.id}/readings`)).json<unknown[]>(),
  ).toHaveLength(1);
  expect((await adult.get(`/api/files/${file.id}`)).status).toBe(200);
  const foreignMeter = await meter(otherObject.id);
  expect(
    (
      await adult.post(`/api/meters/${foreignMeter.id}/readings`, {
        occurredOn: '2026-10-20',
        values: ['1.000'],
        photoIds: [file.id],
      })
    ).status,
  ).toBe(404);
});
it('R1c.8: batch атомарен при lost COMMIT и stale latest-reading-base; серия значений и предупреждение сохранены', async () => {
  const parent = await object(),
    first = await meter(parent.id, true),
    second = await meter(parent.id);
  const snap = await snapshot<{ id: string; previousReading: { id: string } | null }[]>(
    `/api/objects/${parent.id}/meters`,
  );
  const body = {
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    readings: snap.data.map((m) => ({
      meterId: m.id,
      occurredOn: '2026-10-20',
      values: ['110.000'],
      expectedUpdatedAt: snap.versions.find((v) => v.id === m.id)?.version,
      expectedLatestReadingId: m.previousReading?.id ?? null,
    })),
  };
  await loseCommittedReply(body.idempotencyKey, () =>
    adult.post(`/api/objects/${parent.id}/readings`, body),
  );
  const repeated = await Promise.all([
    adult.post(`/api/objects/${parent.id}/readings`, body),
    other.post(`/api/objects/${parent.id}/readings`, body),
  ]);
  expect(repeated.every((r) => r.status === 201)).toBe(true);
  const result = repeated[0]?.json<Card[]>();
  expect(result?.[0]?.receipt.results).toHaveLength(2);
  expect(repeated[1]?.json()).toEqual(result);
  const stale = await adult.post(`/api/objects/${parent.id}/readings`, {
    ...body,
    idempotencyKey: randomUUID(),
    readings: body.readings.map((r) => ({ ...r, occurredOn: '2026-11-20', values: ['120.000'] })),
  });
  expect(stale.json().code).toBe('STALE_READING_BASE');
  expect((await adult.get(`/api/meters/${first.id}/readings`)).json<unknown[]>()).toHaveLength(2);
  expect((await adult.get(`/api/meters/${second.id}/readings`)).json<unknown[]>()).toHaveLength(1);
});
it('R1c.8: повтор выполнения серии даёт один преемник/event/push; время намерения не расширяет 7 секунд', async () => {
  const body = {
    title: 'Повторяемое офлайн дело',
    placement: place(),
    planOn: '2026-10-12',
    repeatRule: { kind: 'daily' },
    assigneeId: world.boris.id,
  };
  const row = (await admin.post('/api/tasks', body)).json<Card>();
  const observed = await snapshot(`/api/tasks/${row.id}`);
  const done = {
    status: 'done',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: observed.versions[0]?.version,
    clientActedAt: '2026-01-01T00:00:00Z',
  };
  await loseCommittedReply(done.idempotencyKey, () =>
    adult.post(`/api/tasks/${row.id}/status`, done),
  );
  const replies = await Promise.all([
    adult.post(`/api/tasks/${row.id}/status`, done),
    other.post(`/api/tasks/${row.id}/status`, done),
  ]);
  const result = replies[0]?.json<Card>();
  expect(replies[1]?.json<Card>().receipt).toEqual(result?.receipt);
  expect(
    (
      await world.database.admin.query(
        'SELECT id FROM tasks WHERE predecessor_id=$1 AND deleted_at IS NULL',
        [row.id],
      )
    ).rows,
  ).toHaveLength(1);
  expect(
    (
      await world.database.admin.query(
        "SELECT id FROM deadline_notifications WHERE record_id=$1 AND event_kind='task_done'",
        [row.id],
      )
    ).rows,
  ).toHaveLength(1);
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [row.id],
  );
  expect(
    (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: result?.completionEventId })).json()
      .code,
  ).toBe('UNDO_EXPIRED');
});
it('R1c.8: readonly snapshot радара/shopping/последних карточек помечен аккаунтом и не выдаёт editable-версии', async () => {
  const personal = (
    await adult.post('/api/shopping', { title: 'Личная покупка аккаунта А' })
  ).json<Card>();
  const foreign = (
    await child.post('/api/shopping', { title: 'Личная покупка аккаунта Б' })
  ).json<Card>();
  const late = (await child.get('/api/shopping?scope=personal&offline=true')).json<
    Snapshot<Card[]>
  >();
  expect(late.accountId).toBe(world.vera.id);
  expect(late.versions).toEqual([]);
  expect(late.data.map((row) => row.id)).toContain(foreign.id);
  expect(late.data.map((row) => row.id)).not.toContain(personal.id);
  const contactResponse = await adult.post('/api/contacts', {
    title: 'Последний личный контакт',
    kind: 'person',
  });
  expect(contactResponse.status, contactResponse.text).toBe(201);
  const contactId = contactResponse.json<Card>().id;
  const documentResponse = await adult.post('/api/documents', {
    title: 'Последний личный документ',
    data: { type: 'other' },
    placement: { spaceId: world.boris.personalSpaceId },
  });
  expect(documentResponse.status, documentResponse.text).toBe(201);
  const documentId = documentResponse.json<Card>().id;
  for (const path of [
    `/api/shopping/${personal.id}`,
    `/api/contacts/${contactId}`,
    `/api/documents/${documentId}`,
    `/api/documents/${documentId}/versions`,
    '/api/contacts',
    '/api/documents',
    '/api/objects',
    '/api/accounts',
  ]) {
    const read = await snapshot(path);
    expect(read.versions).toEqual([]);
  }
  const radar = await child.get('/api/deadlines?from=2026-10-01&to=2026-10-31&offline=true');
  expect(radar.status, radar.text).toBe(200);
  expect(radar.json<Snapshot>().accountId).toBe(world.vera.id);
  expect(radar.json<Snapshot>().versions).toEqual([]);
  const today = await child.get('/api/tasks/today?offline=true');
  expect(today.status, today.text).toBe(200);
  expect(today.json<Snapshot>().accountId).toBe(world.vera.id);
  expect((await adult.get(`/api/documents/${documentId}/history?offline=true`)).status).toBe(400);
  expect((await adult.get('/api/export/history?offline=true')).json().accountId).toBeUndefined();
});
it('SHOP/R1c.8: lost COMMIT покупок не удваивает позиции/bought/history; квитанции только аккаунту и неизменны под RLS', async () => {
  const intent = {
    title: 'Покупка с потерянным подтверждением',
    placement: place(),
    idempotencyKey: randomUUID(),
  };
  await loseCommittedReply(intent.idempotencyKey, () => adult.post('/api/shopping', intent));
  const row = (await adult.post('/api/shopping', intent)).json<Card>();
  const bought = { bought: true, idempotencyKey: randomUUID() };
  await loseCommittedReply(bought.idempotencyKey, () =>
    adult.post(`/api/shopping/${row.id}/bought`, bought),
  );
  const confirmed = (await adult.post(`/api/shopping/${row.id}/bought`, bought)).json<Card>();
  expect(confirmed.receipt.ownerAccountId).toBe(world.boris.id);
  expect((await adult.get(`/api/shopping/${row.id}/history`)).json<unknown[]>()).toHaveLength(2);
  const { sql } = await import('@homecrm/db');
  const hidden = await world.module.appDb.withAccount(world.vera.id, (tx) =>
    tx.execute(sql`SELECT receipt FROM api_operations WHERE key=${bought.idempotencyKey}::uuid`),
  );
  expect(hidden.rows).toEqual([]);
  expect(JSON.stringify(confirmed.receipt)).not.toContain(intent.title);
  for (const pool of [world.database.worker, world.database.auth])
    await expect(pool.query('SELECT receipt FROM api_operations')).rejects.toMatchObject({
      code: '42501',
    });
  await expect(
    world.database.app.query('UPDATE api_operations SET receipt=NULL WHERE false'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    world.database.app.query('DELETE FROM api_operations WHERE false'),
  ).rejects.toMatchObject({ code: '42501' });
});
it('R1c.8: чужое личное намерение note/task/photo не попадает под аккаунт B; snapshot помечен текущим владельцем', async () => {
  const intent = {
    title: 'Личный замысел аккаунта А',
    body: 'Личный текст аккаунта А',
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
  };
  const refused = await child.post('/api/notes', intent);
  expect(refused.status, refused.text).toBe(403);
  expect(refused.json().code).toBe('ACCOUNT_MISMATCH');
  expect(
    (
      await world.database.admin.query(
        'SELECT key FROM api_operations WHERE account_id=$1 AND key=$2',
        [world.vera.id, intent.idempotencyKey],
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await world.database.admin.query('SELECT id FROM notes WHERE author_id=$1 AND title=$2', [
        world.vera.id,
        intent.title,
      ])
    ).rows,
  ).toEqual([]);
  const owned = await adult.post('/api/notes', intent);
  expect(owned.status, owned.text).toBe(201);
  expect(owned.json<Card>().receipt.ownerAccountId).toBe(world.boris.id);
  const childSnapshot = (await child.get('/api/notes?offline=true')).json<Snapshot<Card[]>>();
  expect(childSnapshot.accountId).toBe(world.vera.id);
  expect(childSnapshot.data.some((row) => row.id === owned.json<Card>().id)).toBe(false);
  const parent = await object(),
    observed = await snapshot(`/api/objects/${parent.id}`),
    key = randomUUID();
  const refusedPhoto = await upload(
    parent.id,
    key,
    observed.versions[0]?.version ?? '',
    photo,
    admin,
  );
  expect(refusedPhoto.statusCode, refusedPhoto.body).toBe(403);
  expect(refusedPhoto.json().code).toBe('ACCOUNT_MISMATCH');
  expect(
    (
      await world.database.admin.query('SELECT id FROM object_files WHERE parent_id=$1', [
        parent.id,
      ])
    ).rows,
  ).toEqual([]);
  expect(
    (await world.database.admin.query('SELECT key FROM api_operations WHERE key=$1', [key])).rows,
  ).toEqual([]);
  const missingOwner = await adult.post('/api/notes', {
    title: 'Без владельца',
    offline: true,
    idempotencyKey: randomUUID(),
  });
  expect(missingOwner.status).toBe(400);
});
it('R1c.8: предупреждение показания устойчиво после потерянного ответа и новых отсчётов', async () => {
  const parent = await object(),
    current = await meter(parent.id, true);
  const october = await adult.post(`/api/meters/${current.id}/readings`, {
    occurredOn: '2026-10-20',
    values: ['110.000'],
  });
  expect(october.status).toBe(201);
  const observed = await snapshot(`/api/meters/${current.id}`);
  const intent = {
    occurredOn: '2026-11-20',
    values: ['130.000'],
    expectedLatestReadingId: october.json<Card>().id,
    expectedUpdatedAt: observed.versions[0]?.version,
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
  };
  await loseCommittedReply(intent.idempotencyKey, () =>
    adult.post(`/api/meters/${current.id}/readings`, intent),
  );
  const first = (await adult.post(`/api/meters/${current.id}/readings`, intent)).json<{
    id: string;
    warnings: string[];
    receipt: OperationReceipt;
  }>();
  expect(first.warnings).toHaveLength(1);
  expect(first.receipt.warningIds).toEqual([first.id]);
  await adult.post(`/api/meters/${current.id}/readings`, {
    occurredOn: '2026-12-20',
    values: ['131.000'],
  });
  const again = (await adult.post(`/api/meters/${current.id}/readings`, intent)).json<
    typeof first
  >();
  expect(again.warnings).toEqual(first.warnings);
  expect(again.receipt).toEqual(first.receipt);
});
it('R1c.8 B1: два фото чужого общего объекта продолжают точную базу; late replay не скрывает чужую правку', async () => {
  const created = await admin.post('/api/objects', {
    title: 'Общий объект другого автора',
    placement: place(),
  });
  expect(created.status, created.text).toBe(201);
  const parent = created.json<Card>();
  const base = (await snapshot(`/api/objects/${parent.id}`)).versions[0]?.version ?? '';
  const key = randomUUID();
  await loseCommittedReply(key, () => upload(parent.id, key, base));
  const first = await upload(parent.id, key, base);
  expect(first.statusCode, first.body).toBe(201);
  const file = first.json<Card>();
  const receipt = OperationReceipt.parse(file.receipt);
  expect(receipt.parent?.id).toBe(parent.id);
  expect(receipt.parent?.updatedAt).not.toBe(base);
  expect(receipt.parent?.updatedAt).toBe(
    (await snapshot(`/api/objects/${parent.id}`)).versions[0]?.version,
  );
  const ownVersion = receipt.parent?.updatedAt ?? '';
  const second = await upload(parent.id, randomUUID(), ownVersion);
  expect(second.statusCode, second.body).toBe(201);
  expect(second.json().id).not.toBe(file.id);
  expect((await upload(parent.id, key, base)).json().receipt).toEqual(receipt);
  const secondReceipt = OperationReceipt.parse(second.json().receipt);
  expect(secondReceipt.parent?.updatedAt).not.toBe(ownVersion);
  expect(
    (await patch('objects', parent.id, { title: 'Правка другого устройства' }, admin)).status,
  ).toBe(200);
  // Повтор первого COMMIT возвращает его версию, а не более свежую чужую.
  expect((await upload(parent.id, key, base)).json().receipt).toEqual(receipt);
  const stale = await upload(parent.id, randomUUID(), secondReceipt.parent?.updatedAt ?? '');
  expect(stale.statusCode).toBe(409);
  expect(stale.json().code).toBe('STALE_VERSION');
  expect((await adult.get(`/api/objects/${parent.id}/files`)).json<unknown[]>()).toHaveLength(2);
  expect((await adult.get(`/api/objects/${parent.id}`)).json().title).toBe(
    'Правка другого устройства',
  );
});
for (const batch of [false, true])
  it(`R1c.8 B2: ${batch ? 'batch' : 'single'} replay требует исходное живое фото/связь/доступ после lost COMMIT`, async () => {
    const parent = await object();
    const first = await meter(parent.id);
    const meterIds = batch ? [first.id, (await meter(parent.id)).id] : [first.id];
    const base = (await snapshot(`/api/objects/${parent.id}`)).versions[0]?.version ?? '';
    const uploaded = await upload(parent.id, randomUUID(), base);
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const file = uploaded.json<Card>();
    const inputs = [];
    for (const id of meterIds)
      inputs.push({
        meterId: id,
        occurredOn: '2026-10-20',
        values: ['100.000'],
        photoIds: id === first.id ? [file.id] : [],
        expectedUpdatedAt: (await snapshot(`/api/meters/${id}`)).versions[0]?.version,
        expectedLatestReadingId: null,
      });
    const metadata = {
      offline: true,
      ownerAccountId: world.boris.id,
      idempotencyKey: randomUUID(),
    };
    const { meterId: _meterId, ...single } = inputs[0] ?? {};
    const body = batch ? { ...metadata, readings: inputs } : { ...metadata, ...single };
    const send = () =>
      adult.post(
        batch ? `/api/objects/${parent.id}/readings` : `/api/meters/${first.id}/readings`,
        body,
      );
    await loseCommittedReply(metadata.idempotencyKey, send);
    const repeated = await send();
    expect(repeated.status, repeated.text).toBe(201);
    const cards = batch ? repeated.json<Card[]>() : [repeated.json<Card>()];
    const reading = cards.find((row) => (row as Card & { parentId: string }).parentId === first.id);
    if (!reading) throw new Error('Missing committed reading');
    const receipt = reading.receipt;
    expect(receipt.results).toHaveLength(meterIds.length);
    expect(reading).toMatchObject({ photoIds: [file.id] });
    const history = (
      await world.database.admin.query('SELECT id FROM meter_readings_history WHERE record_id=$1', [
        reading.id,
      ])
    ).rows;
    expect((await adult.post(`/api/objects/${parent.id}/files/${file.id}/trash`, {})).status).toBe(
      200,
    );
    expect((await send()).status).toBe(404);
    expect(
      (await adult.post(`/api/objects/${parent.id}/files/${file.id}/restore`, {})).status,
    ).toBe(200);
    expect((await send()).status).toBe(201);
    const link = (
      await world.database.admin.query(
        "SELECT id FROM record_links WHERE left_id=$1 AND right_id=$2 AND role='reading_photo'",
        [reading.id, file.id],
      )
    ).rows[0].id as string;
    expect((await adult.post(`/api/links/${link}/trash`, {})).status).toBe(200);
    expect((await send()).status).toBe(404);
    expect((await adult.post(`/api/links/${link}/restore`, {})).status).toBe(200);
    expect((await send()).status).toBe(201);
    await world.database.admin.query(
      "UPDATE space_members SET role='child' WHERE account_id=$1 AND space_id=$2 AND left_at IS NULL",
      [world.boris.id, world.houseId],
    );
    try {
      expect((await send()).status).toBe(403);
    } finally {
      await world.database.admin.query(
        "UPDATE space_members SET role='adult' WHERE account_id=$1 AND space_id=$2 AND left_at IS NULL",
        [world.boris.id, world.houseId],
      );
    }
    const restored = await send();
    expect(restored.status, restored.text).toBe(201);
    expect((batch ? restored.json<Card[]>()[0] : restored.json<Card>())?.receipt).toEqual(receipt);
    expect(
      (
        await world.database.admin.query(
          'SELECT id FROM meter_readings_history WHERE record_id=$1',
          [reading.id],
        )
      ).rows,
    ).toEqual(history);
    for (const id of meterIds)
      expect((await adult.get(`/api/meters/${id}/readings`)).json<unknown[]>()).toHaveLength(1);
  });
it('R1c.8: owner/key защищён от аккаунта B, replay закрывается при удалении/назначении/аудитории/уходе', async () => {
  const key = randomUUID(),
    body = {
      title: 'Личный ключ',
      offline: true,
      ownerAccountId: world.boris.id,
      idempotencyKey: key,
    };
  const original = (await adult.post('/api/tasks', body)).json<Card>();
  const foreign = await child.post('/api/tasks', body);
  expect(foreign.status).toBe(403);
  expect(foreign.json().code).toBe('ACCOUNT_MISMATCH');
  expect(
    (
      await world.database.admin.query(
        'SELECT key FROM api_operations WHERE account_id=$1 AND key=$2',
        [world.vera.id, key],
      )
    ).rows,
  ).toEqual([]);
  expect((await admin.get(`/api/tasks/${original.id}`)).status).toBe(404);
  await adult.post(`/api/tasks/${original.id}/trash`, {});
  expect((await adult.post('/api/tasks', body)).status).toBe(403);
  const assigned = (
    await adult.post('/api/tasks', {
      title: 'Доступ ребёнка',
      placement: place(),
      assigneeId: world.vera.id,
    })
  ).json<Card>();
  const childSnap = await child.get(`/api/tasks/${assigned.id}?offline=true`);
  const version = childSnap.json<Snapshot>().versions[0]?.version;
  const childBody = {
    title: 'Правка ребёнка',
    offline: true,
    ownerAccountId: world.vera.id,
    idempotencyKey: randomUUID(),
    expectedUpdatedAt: version,
  };
  expect((await patch('tasks', assigned.id, childBody, child)).status).toBe(200);
  await patch('tasks', assigned.id, { assigneeId: world.boris.id });
  expect((await patch('tasks', assigned.id, childBody, child)).status).toBe(403);
  await adult.post(`/api/tasks/${assigned.id}/move`, {
    spaceId: world.houseId,
    audience: 'adults',
    confirmed: true,
  });
  expect((await patch('tasks', assigned.id, childBody, child)).status).toBe(404);
  const noteBody = {
    title: 'Общее перед уходом',
    placement: place(),
    offline: true,
    ownerAccountId: world.boris.id,
    idempotencyKey: randomUUID(),
  };
  expect((await adult.post('/api/notes', noteBody)).status).toBe(201);
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=$1 WHERE account_id=$1 AND space_id=$2',
    [world.boris.id, world.houseId],
  );
  expect((await adult.post('/api/notes', noteBody)).status).toBe(404);
});
