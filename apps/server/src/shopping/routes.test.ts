import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fromBuffer, type ZipFile } from 'yauzl';
import { BASE_URL, type Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device, admin: Device;
let legacySearchResponse: { safeParse(value: unknown): { success: boolean } };
type Item = {
  id: string;
  updatedAt: string;
  boughtAt: string | null;
  deletedAt: string | null;
  hasOtherContributions: boolean;
  title: string;
};
beforeAll(async () => {
  const legacyModule = new URL('../../../web/src/search/api.ts', import.meta.url).href;
  legacySearchResponse = (await import(legacyModule)).SearchResponse;
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
const place = () => ({ spaceId: world.houseId, audience: 'household' });
async function create(fields: Record<string, unknown> = {}, device = adult) {
  const response = await device.post('/api/shopping', { title: 'Вымышленная покупка', ...fields });
  expect(response.status, response.text).toBe(201);
  return response.json<Item>();
}
const patch = (id: string, fields: unknown, device = adult) =>
  device.request('PATCH', `/api/shopping/${id}`, { json: fields });
it('SHOP-1…3: быстрый ввод, полные поля, общий ребёнок, личное закрыто администратору и неизменные авторы', async () => {
  const personal = await create({ title: 'Молоко 2 упаковки непонятный хвост' });
  expect(personal.title).toBe('Молоко 2 упаковки непонятный хвост');
  expect((await admin.get(`/api/shopping/${personal.id}`)).status).toBe(404);
  const common = await create(
    {
      placement: place(),
      quantity: '2 упаковки',
      data: { note: 'Тестовая заметка', store: 'Вымышленный магазин', category: 'Продукты' },
    },
    child,
  );
  const changed = await patch(
    common.id,
    { quantity: '3 упаковки', expectedUpdatedAt: common.updatedAt },
    adult,
  );
  expect(changed.status, changed.text).toBe(200);
  expect(changed.json()).toMatchObject({
    authorId: world.vera.id,
    quantity: '3 упаковки',
    hasOtherContributions: true,
    data: { note: 'Тестовая заметка', store: 'Вымышленный магазин', category: 'Продукты' },
  });
  const contribution = await create({ placement: place() });
  expect(
    (await patch(contribution.id, { data: { note: 'Чужой содержательный вклад' } }, child)).status,
  ).toBe(200);
  expect(
    (
      await adult.post(`/api/shopping/${contribution.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
        expectedUpdatedAt: (await adult.get(`/api/shopping/${contribution.id}`)).json<Item>()
          .updatedAt,
      })
    ).status,
  ).toBe(403);
  expect(
    (await patch(common.id, { title: 'Конфликт', expectedUpdatedAt: common.updatedAt })).json()
      .code,
  ).toBe('STALE_VERSION');
});
it('SHOP: ключи, конкурентные повторы, bought true/false, единичная история и новая отметка после отмены', async () => {
  const body = { title: 'Повтор покупки', placement: place(), idempotencyKey: randomUUID() };
  const replies = await Promise.all([
    adult.post('/api/shopping', body),
    adult.post('/api/shopping', body),
  ]);
  const row = replies[0]?.json<Item>();
  if (!row) throw new Error('Missing shopping');
  expect(replies.every((r) => r.status === 201)).toBe(true);
  expect(replies[1]?.json().id).toBe(row.id);
  expect(
    (await adult.post('/api/shopping', { ...body, title: 'Другое содержание' })).json().code,
  ).toBe('IDEMPOTENCY_CONFLICT');
  const bought = { bought: true, idempotencyKey: randomUUID(), expectedUpdatedAt: row.updatedAt };
  const first = await adult.post(`/api/shopping/${row.id}/bought`, bought);
  expect(first.status).toBe(200);
  expect((await adult.post(`/api/shopping/${row.id}/bought`, bought)).json()).toEqual(first.json());
  expect(
    (await adult.post(`/api/shopping/${row.id}/bought`, { bought: true })).json().boughtAt,
  ).toBe(first.json().boughtAt);
  expect((await adult.get(`/api/shopping/${row.id}/history`)).json<unknown[]>()).toHaveLength(2);
  expect(
    (await adult.post(`/api/shopping/${row.id}/bought`, { bought: false })).json().boughtAt,
  ).toBeNull();
  const again = (await adult.post(`/api/shopping/${row.id}/bought`, { bought: true })).json<Item>();
  expect(new Date(again.boughtAt ?? '').getTime()).toBeGreaterThanOrEqual(
    new Date(String(first.json().boughtAt)).getTime(),
  );
});
it('SHOP: второй дом выбирается явно, справочники/ссылки не показывают скрытое', async () => {
  const house = (
    await world.database.admin.query(
      "INSERT INTO spaces(kind,name) VALUES('household','Вымышленный второй дом') RETURNING id",
    )
  ).rows[0].id;
  await world.database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult'),($1,$3,'admin')",
    [house, world.boris.id, world.anna.id],
  );
  const second = await create({
    placement: { spaceId: house, audience: 'household' },
    title: 'Покупка второго дома',
  });
  expect((await adult.get('/api/shopping')).json().code).toBe('HOUSE_REQUIRED');
  expect(
    (await adult.get(`/api/shopping?spaceId=${house}`)).json<Item[]>().map((i) => i.id),
  ).toContain(second.id);
  expect((await child.get(`/api/shopping/${second.id}`)).status).toBe(404);
  const hidden = (await adult.post('/api/objects', { title: 'Скрытый личный объект' })).json<{
    id: string;
  }>();
  expect(
    (
      await child.post('/api/shopping', {
        title: 'Ссылка',
        placement: place(),
        links: [{ type: 'object', id: hidden.id }],
      })
    ).status,
  ).toBe(404);
  const task = (
    await adult.post('/api/tasks', { title: 'Настоящее дело покупки', placement: place() })
  ).json<{ id: string }>();
  const linked = await create({ placement: place(), links: [{ type: 'task', id: task.id }] });
  const links = await child.get(`/api/records/shopping_item/${linked.id}/links`);
  expect(links.status).toBe(200);
  expect(links.json<unknown[]>()).toHaveLength(1);
  await adult.post(`/api/tasks/${task.id}/move`, {
    spaceId: world.boris.personalSpaceId,
    confirmed: true,
  });
  expect((await child.get(`/api/records/shopping_item/${linked.id}/links`)).json()).toEqual([]);
});
it('SHOP: семь суток → корзина, повтор задания, restore сбрасывает boughtAt и сохраняет историю', async () => {
  const old = await create({ placement: place() });
  const recent = await create({ placement: place() });
  await world.database.admin.query(
    "UPDATE shopping_items SET bought_at=clock_timestamp()-interval '8 days' WHERE id=$1",
    [old.id],
  );
  await adult.post(`/api/shopping/${recent.id}/bought`, { bought: true });
  expect(
    (await world.database.worker.query('SELECT app.cleanup_bought_shopping() AS changed')).rows[0]
      .changed,
  ).toBeGreaterThanOrEqual(1);
  expect(
    (await world.database.worker.query('SELECT app.cleanup_bought_shopping() AS changed')).rows[0]
      .changed,
  ).toBe(0);
  expect((await adult.get(`/api/shopping/${old.id}`)).json<Item>().deletedAt).toBeTruthy();
  expect((await adult.get(`/api/shopping/${recent.id}`)).json<Item>().deletedAt).toBeNull();
  const restored = await adult.post(`/api/shopping/${old.id}/restore`, {
    idempotencyKey: randomUUID(),
  });
  expect(restored.status, restored.text).toBe(200);
  expect(restored.json()).toMatchObject({ deletedAt: null, boughtAt: null });
  expect(
    (await world.database.worker.query('SELECT app.cleanup_bought_shopping() AS changed')).rows[0]
      .changed,
  ).toBe(0);
  const history = (await adult.get(`/api/shopping/${old.id}/history`)).json<
    { operation: string }[]
  >();
  expect(history.map((h) => h.operation)).toContain('trash');
  expect(history.map((h) => h.operation)).toContain('restore');
  await expect(
    world.database.worker.query('SELECT title FROM shopping_items'),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    world.database.app.query('SELECT app.cleanup_bought_shopping()'),
  ).rejects.toMatchObject({ code: '42501' });
});
it('SHOP: отмена покупки под блокировкой не теряется при конкурентной worker-очистке', async () => {
  const row = await create({ placement: place() });
  await world.database.admin.query(
    "UPDATE shopping_items SET bought_at=clock_timestamp()-interval '8 days' WHERE id=$1",
    [row.id],
  );
  const connection = await world.database.app.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SELECT set_config('app.account_id',$1,true)", [world.boris.id]);
    await connection.query('UPDATE shopping_items SET bought_at=NULL WHERE id=$1', [row.id]);
    const cleanup = world.database.worker.query('SELECT app.cleanup_bought_shopping() AS changed');
    await connection.query('COMMIT');
    expect((await cleanup).rows[0].changed).toBe(0);
    expect((await adult.get(`/api/shopping/${row.id}`)).json()).toMatchObject({
      boughtAt: null,
      deletedAt: null,
    });
  } finally {
    connection.release();
  }
});
it('SHOP: opt-in GIN поиск полей/корзины и настоящий ZIP; старый search enum не меняется', async () => {
  const token = 'Уникальныймагазинпроверки',
    common = await create({ placement: place(), data: { store: token }, quantity: '77 пачек' });
  const personal = await create({ title: `Личное ${token}` });
  expect((await child.get(`/api/search?q=${token}`)).json().total).toBe(0);
  const mixed = 'Смешанныйпоисктеста';
  await world.database.admin.query(
    "INSERT INTO shopping_items(space_id,space_kind,audience,author_id,title) SELECT $1,'household','household',$2,'Аа '||$3||' '||n FROM generate_series(1,151) n",
    [world.houseId, world.boris.id, mixed],
  );
  const note = (await adult.post('/api/notes', { title: `Яя ${mixed}`, placement: place() })).json<{
    id: string;
  }>();
  const legacy = (await child.get(`/api/search?q=${mixed}`)).json();
  expect(legacySearchResponse.safeParse(legacy).success).toBe(true);
  expect(legacy).toMatchObject({
    total: 1,
    hasMore: false,
    groups: [{ type: 'note', items: [{ id: note.id }] }],
  });
  const result = await child.get(`/api/search?q=${token}&includeShopping=true`);
  expect(result.json()).toMatchObject({
    total: 1,
    groups: [{ type: 'shopping_item', items: [{ id: common.id }] }],
  });
  expect((await admin.get(`/api/search?q=${token}&includeShopping=true`)).json().total).toBe(1);
  await adult.post(`/api/shopping/${common.id}/trash`, {});
  expect((await child.get(`/api/search?q=${token}&includeShopping=true`)).json().total).toBe(0);
  const response = await world.app.inject({
    method: 'POST',
    url: '/api/export/archive',
    remoteAddress: admin.ip,
    headers: {
      cookie: [...admin.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      origin: BASE_URL,
    },
    payload: {
      password: world.anna.password,
      scope: { kind: 'household', householdId: world.houseId },
      confirmed: true,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
  const entries = await unzip(response.rawPayload);
  const exported = JSON.parse(entries.get('shopping_items.json')?.toString() ?? 'null') as {
    id: string;
    data: { store: string };
    history: unknown[];
    deleted_at: string | null;
  }[];
  expect(exported.find((item) => item.id === common.id)).toMatchObject({
    data: { store: token },
    deleted_at: expect.any(String),
  });
  expect(exported.some((item) => item.id === personal.id)).toBe(false);
  const history = JSON.parse(entries.get('history.json')?.toString() ?? 'null') as {
    record_id: string;
  }[];
  expect(history.filter((item) => item.record_id === common.id).length).toBeGreaterThan(1);
});
async function unzip(source: Buffer) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(source, { lazyEntries: true }, (error, result) =>
      error ? reject(error) : result ? resolve(result) : reject(new Error('Missing ZIP')),
    ),
  );
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('error', reject);
    zip.on('end', resolve);
    zip.on('entry', (entry) =>
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          reject(error ?? new Error('Missing entry'));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => {
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        });
      }),
    );
    zip.readEntry();
  });
  return entries;
}
