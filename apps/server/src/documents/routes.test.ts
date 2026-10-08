import { randomBytes } from 'node:crypto';
import { createWorkerDatabase, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { enqueueDeadlineWarnings, refreshDeadlines } from '../deadlines/engine.ts';
import { FileCipher } from '../files/crypto.ts';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let admin: Device;
let child: Device;
const blocks = new Map<string, Buffer>();
beforeAll(async () => {
  world = await createWorld({
    files: {
      cipher: new FileCipher(randomBytes(32), 1),
      storage: {
        put: async (key, data) => {
          blocks.set(key, Buffer.from(data));
        },
        get: async (key) => {
          const data = blocks.get(key);
          if (!data) throw new Error('Missing test block');
          return data;
        },
        delete: async (key) => {
          blocks.delete(key);
        },
        olderThan: async function* () {},
      },
    },
  });
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
async function create(extra: Record<string, unknown> = {}, device = adult) {
  const response = await device.post('/api/documents', { title: 'Вымышленный документ', ...extra });
  expect(response.status, response.text).toBe(201);
  return response.json<{
    id: string;
    status: string;
    spaceKind: string;
    audience: string;
    assigneeId: string;
    data: Record<string, unknown>;
  }>();
}
it('DOC-1/2: закрытые типы, личное взрослого, документы ребёнка и запрет расширения удостоверения', async () => {
  expect((await adult.get('/api/document-types')).json()).toHaveLength(20);
  expect(
    (await adult.post('/api/documents', { title: 'Вымышленный', data: { type: 'invented' } }))
      .status,
  ).toBe(400);
  const personal = await create({ owner: { kind: 'member', id: world.boris.id } });
  expect(personal.spaceKind).toBe('personal');
  expect((await admin.get(`/api/documents/${personal.id}`)).status).toBe(404);
  const owned = await create({
    owner: { kind: 'member', id: world.vera.id },
    data: { type: 'birth_certificate' },
  });
  expect(owned).toMatchObject({ spaceKind: 'household', audience: 'adults' });
  expect((await child.get(`/api/documents/${owned.id}`)).status).toBe(404);
  expect(
    (
      await adult.post(`/api/documents/${owned.id}/move`, {
        spaceId: world.houseId,
        audience: 'household',
        confirmed: true,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await adult.post('/api/documents', {
        title: 'Вымышленный',
        owner: { kind: 'member', id: world.vera.id },
        data: { type: 'russian_passport' },
        placement: { spaceId: world.houseId, audience: 'household' },
      })
    ).status,
  ).toBe(403);
});
it('DOC-5: атомарное продление, предыдущая версия, перенос связей и ответственного, гонка', async () => {
  const old = await create({
    title: 'Вымышленный договор',
    data: { type: 'contract', number: 'DOC-FAKE-001', expiresOn: '2026-11-01' },
    placement: { spaceId: world.houseId, audience: 'adults' },
    assigneeId: world.anna.id,
  });
  const object = (await adult.post('/api/objects', { title: 'Вымышленный объект связи' })).json<{
    id: string;
  }>();
  expect(
    (
      await adult.post('/api/links', {
        left: { type: 'document', id: old.id },
        right: { type: 'object', id: object.id },
        role: 'Договор',
      })
    ).status,
  ).toBe(201);
  const attempts = await Promise.all([
    adult.post(`/api/documents/${old.id}/renew`, {
      data: { type: 'contract', number: 'DOC-FAKE-002', expiresOn: '2027-11-01' },
    }),
    adult.post(`/api/documents/${old.id}/renew`, {
      data: { type: 'contract', expiresOn: '2028-11-01' },
    }),
  ]);
  expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
  const current = attempts
    .find((r) => r.status === 201)
    ?.json<{ id: string; previousId: string; assigneeId: string }>();
  expect(current).toMatchObject({ previousId: old.id, assigneeId: world.anna.id });
  expect((await adult.get(`/api/documents/${old.id}`)).json()).toMatchObject({
    status: 'invalid',
    data: { number: 'DOC-FAKE-001' },
  });
  expect((await adult.get(`/api/documents/${current?.id}/versions`)).json()).toHaveLength(2);
  const links = await world.database.admin.query('SELECT role FROM record_links WHERE left_id=$1', [
    current?.id,
  ]);
  expect(links.rows).toEqual([{ role: 'Договор' }]);
  expect(
    (
      await adult.post(`/api/documents/${current?.id}/renew`, {
        data: { indefinite: true, expiresOn: '2029-01-01' },
      })
    ).status,
  ).toBe(400);
  expect((await adult.get(`/api/documents/${current?.id}`)).json()).toMatchObject({
    status: 'valid',
  });
});
it('DOC-7: фильтры в поясе дома, границы 90 дней включительны; номер и заметка не индексируются', async () => {
  const localToday = (
    await world.database.admin.query(
      "SELECT (now() AT TIME ZONE 'Asia/Yekaterinburg')::date::text AS date",
    )
  ).rows[0].date as string;
  const date = (days: number) =>
    new Date(Date.parse(`${localToday}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  try {
    const expired = await create({
      title: 'Вымышленный просроченный',
      data: { expiresOn: date(-1) },
    });
    const today = await create({
      title: 'Вымышленный сегодня',
      data: {
        type: 'international_passport',
        expiresOn: date(0),
        number: '918273645000',
        series: 'SERIESONLY',
        note: 'Секретзаметки',
      },
    });
    const edge = await create({ data: { expiresOn: date(90) } });
    const future = await create({ data: { expiresOn: date(91) } });
    const expiredRows = (await adult.get('/api/documents?expiry=expired')).json<{ id: string }[]>();
    expect(expiredRows.map((r) => r.id)).toContain(expired.id);
    expect(expiredRows.map((r) => r.id)).not.toContain(today.id);
    const expiring = (await adult.get('/api/documents?expiry=expiring'))
      .json<{ id: string }[]>()
      .map((r) => r.id);
    expect(expiring).toEqual(expect.arrayContaining([today.id, edge.id]));
    expect(expiring).not.toContain(future.id);
    for (const q of ['918273645000', 'SERIESONLY', 'Секретзаметки'])
      expect((await adult.get(`/api/search?q=${encodeURIComponent(q)}`)).json()).toMatchObject({
        total: 0,
      });
    expect(
      (await adult.get(`/api/search?q=${encodeURIComponent('Загранпаспорт')}`)).text,
    ).toContain(today.id);
    expect(
      (await adult.get(`/api/documents?type=international_passport&scope=personal`)).text,
    ).toContain(today.id);
  } finally {
    vi.useRealTimers();
  }
});
it('DOC-3: срок документа в радаре, 180 дней предупреждения и скрытие после продления', async () => {
  const old = await create({ data: { type: 'international_passport', expiresOn: '2026-12-01' } });
  const rules = await world.database.admin.query(
    'SELECT id,rule FROM deadlines WHERE document_id=$1',
    [old.id],
  );
  expect(rules.rows[0]?.rule.warnings).toEqual([180, 90, 30]);
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-08T07:00Z'),
    true,
  );
  const radar = await adult.get('/api/deadlines?from=2026-10-01&to=2027-05-01');
  expect(radar.status, radar.text).toBe(200);
  expect(radar.text).toContain(old.id);
  expect((await admin.get('/api/deadlines?from=2026-10-01&to=2027-05-01')).text).not.toContain(
    old.id,
  );
  const renewed = await adult.post(`/api/documents/${old.id}/renew`, {
    data: { type: 'international_passport', expiresOn: '2027-05-01' },
  });
  expect(renewed.status, renewed.text).toBe(201);
  expect((await adult.get('/api/deadlines?from=2026-10-01&to=2027-05-01')).text).not.toContain(
    old.id,
  );
  const early = await create({ data: { type: 'international_passport', expiresOn: '2027-03-31' } });
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-08T07:00Z'),
    true,
  );
  const earlyRadar = (await adult.get('/api/deadlines?from=2026-10-01&to=2027-05-01')).json<{
    items: { documentId: string; group: string }[];
    groups: Record<string, number>;
  }>();
  expect(earlyRadar.items.find((x) => x.documentId === early.id)?.group).toBe('later');
  expect(earlyRadar.groups.later).toBeGreaterThan(0);
});
it('DOC-2: документ объекта следует месту и корзине, независимо удалённый остаётся в корзине', async () => {
  const object = (
    await adult.post('/api/objects', { title: 'Вымышленный объект документов' })
  ).json<{ id: string }>();
  const live = await create({ owner: { kind: 'object', id: object.id } });
  const trashed = await create({ owner: { kind: 'object', id: object.id } });
  expect((await adult.post(`/api/documents/${trashed.id}/trash`)).status).toBe(200);
  expect(
    (
      await adult.post(`/api/objects/${object.id}/share`, {
        spaceId: world.houseId,
        audience: 'adults',
      })
    ).status,
  ).toBe(200);
  expect((await admin.get(`/api/documents/${live.id}`)).json()).toMatchObject({
    spaceKind: 'household',
    audience: 'adults',
  });
  expect((await adult.post(`/api/objects/${object.id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/documents/${live.id}/restore`)).status).toBe(403);
  expect((await adult.post(`/api/objects/${object.id}/restore`)).status).toBe(200);
  const rows = await world.database.admin.query(
    'SELECT id,deleted_at FROM documents WHERE id=ANY($1::uuid[])',
    [[live.id, trashed.id]],
  );
  expect(rows.rows.find((r) => r.id === live.id).deleted_at).toBeNull();
  expect(rows.rows.find((r) => r.id === trashed.id).deleted_at).not.toBeNull();
});
it('DOC-2: смена роли владельца не раскрывает удостоверение детям, историю, индекс и срок', async () => {
  await world.database.admin.query(
    "UPDATE space_members SET role='adult' WHERE space_id=$1 AND account_id=$2",
    [world.houseId, world.vera.id],
  );
  const doc = await create({
    owner: { kind: 'member', id: world.vera.id },
    assigneeId: world.vera.id,
    data: { type: 'birth_certificate', expiresOn: '2026-10-20' },
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect((await child.get(`/api/documents/${doc.id}`)).status).toBe(200);
  const worker = createWorkerDatabase(world.database.worker),
    now = new Date('2026-10-08T07:00Z');
  await refreshDeadlines(worker, now, true);
  await enqueueDeadlineWarnings(worker, now);
  const states = async () =>
    (
      await world.database.admin.query(
        `SELECT n.status FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id JOIN deadlines d ON d.id=o.deadline_id WHERE d.document_id=$1`,
        [doc.id],
      )
    ).rows;
  expect(await states()).toEqual([{ status: 'pending' }]);
  await world.database.admin.query(
    "UPDATE space_members SET role='child' WHERE space_id=$1 AND account_id=$2",
    [world.houseId, world.vera.id],
  );
  try {
    expect((await child.get(`/api/documents/${doc.id}`)).status).toBe(404);
    expect((await child.get(`/api/documents/${doc.id}/history`)).status).toBe(404);
    await enqueueDeadlineWarnings(worker, now);
    expect(await states()).toEqual([{ status: 'cancelled' }]);
    await world.module.appDb.withAccount(world.vera.id, async (tx) => {
      for (const table of ['documents', 'documents_history', 'search_index', 'deadlines']) {
        const key =
          table === 'documents'
            ? 'id'
            : table === 'documents_history'
              ? 'record_id'
              : table === 'deadlines'
                ? 'document_id'
                : 'source_id';
        expect(
          (
            await tx.execute(
              sql`SELECT 1 FROM ${sql.identifier(table)} WHERE ${sql.identifier(key)}=${doc.id}::uuid`,
            )
          ).rows,
        ).toEqual([]);
      }
    });
  } finally {
    await world.database.admin.query(
      "UPDATE space_members SET role='child' WHERE space_id=$1 AND account_id=$2",
      [world.houseId, world.vera.id],
    );
  }
});
it('DOC-2: файлы нескольких страниц, отдельная корзина, наследование места и восстановление документа', async () => {
  const doc = await create();
  const content = Buffer.from('%PDF-1.7\n% вымышленный документ\n');
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const boundary = 'HomeCRMDocumentTest';
    const file = await world.app.inject({
      method: 'POST',
      url: `/api/documents/${doc.id}/files`,
      headers: {
        cookie: [...adult.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        origin: BASE_URL,
        'user-agent': adult.userAgent,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      remoteAddress: adult.ip,
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="page-${i}.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(file.statusCode, file.body).toBe(201);
    ids.push(file.json<{ id: string }>().id);
  }
  expect((await adult.get(`/api/documents/${doc.id}/files`)).json()).toHaveLength(2);
  expect((await admin.get(`/api/files/${ids[0]}`)).status).toBe(404);
  expect(
    (
      await adult.post(`/api/documents/${doc.id}/move`, {
        spaceId: world.houseId,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await admin.get(`/api/documents/${doc.id}/files`)).json()).toHaveLength(2);
  expect((await adult.post(`/api/documents/${doc.id}/files/${ids[0]}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/documents/${doc.id}/trash`)).status).toBe(200);
  expect((await adult.post(`/api/documents/${doc.id}/restore`)).status).toBe(200);
  expect((await adult.get(`/api/documents/${doc.id}/files`)).json()).toHaveLength(1);
});
it('журнал не содержит серию, номер, название и заметку документа', async () => {
  const values = ['Тестназваниядокумента', '991122334455', 'АБСЕРИЯ', 'Тестличнойзаметки'];
  const doc = await create({
    title: values[0],
    data: { number: values[1], series: values[2], note: values[3] },
  });
  await adult.get(`/api/documents/${doc.id}`);
  for (const value of values) expect(world.requestLog.join('\n')).not.toContain(value);
});
it('DOC-5/DATA-1: очистка старой версии не удаляет новую и обнуляет предшественника', async () => {
  const old = await create();
  const renewed = await adult.post(`/api/documents/${old.id}/renew`, {
    data: { indefinite: true },
  });
  expect(renewed.status, renewed.text).toBe(201);
  const current = renewed.json<{ id: string }>();
  expect((await adult.post(`/api/documents/${old.id}/trash`)).status).toBe(200);
  await world.database.admin.query('ALTER TABLE documents DISABLE TRIGGER documents_trash_time');
  try {
    await world.database.admin.query(
      "UPDATE documents SET deleted_at=now()-interval '31 days' WHERE id=$1",
      [old.id],
    );
  } finally {
    await world.database.admin.query('ALTER TABLE documents ENABLE TRIGGER documents_trash_time');
  }
  expect(
    (await world.database.worker.query('DELETE FROM documents WHERE id=$1', [old.id])).rowCount,
  ).toBe(1);
  expect((await adult.get(`/api/documents/${current.id}`)).json()).toMatchObject({
    status: 'valid',
    previousId: null,
  });
});
