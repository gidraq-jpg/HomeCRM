import { randomUUID } from 'node:crypto';
import { canViewSql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { provisionAccount } from '../auth/provision.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
let adult: Device;
let second: Device;
let child: Device;
let admin: Device;
interface Card {
  id: string;
  title: string;
  objectType: string;
  spaceKind: string;
  spaceId: string;
  audience: string | null;
  authorId: string;
  assigneeId: string;
  updatedAt: string;
  deletedAt: string | null;
  fields: { id: string; name: string; value: string; position: number; deletedAt: string | null }[];
}
interface Event {
  id: string;
  text: string;
  occurredOn: string;
  amountKopecks: number | null;
  rating: number | null;
  deletedAt: string | null;
  updatedAt: string;
}
interface Page {
  items: { id: string; source: string; text?: string; [key: string]: unknown }[];
  nextCursor: string | null;
}
const common = () => ({ spaceId: world.houseId, audience: 'household' });
const url = (id: string) => `/api/objects/${id}`;
const patch = (device: Device, id: string, body: unknown) =>
  device.request('PATCH', url(id), { json: body });
async function create(device = adult, body: Record<string, unknown> = {}): Promise<Card> {
  const response = await device.post('/api/objects', { title: 'Вымышленный объект', ...body });
  expect(response.status, response.text).toBe(201);
  return response.json<Card>();
}
async function event(
  id: string,
  device = adult,
  body: Record<string, unknown> = {},
): Promise<Event> {
  const response = await device.post(`${url(id)}/events`, {
    occurredOn: '2026-10-06',
    text: 'Вымышленное событие',
    ...body,
  });
  expect(response.status, response.text).toBe(201);
  return response.json<Event>();
}
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  second = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  await provisionAccount(world.fixtures, {
    username: 'sergey',
    displayName: 'Сергей',
    password: 'fictional-sergey-pass',
    householdId: world.houseId,
    role: 'adult',
  });
  await second.signIn('sergey', 'fictional-sergey-pass');
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
it('контекст заметки выбирает место и аудиторию настоящего объекта', async () => {
  const object = await create(adult, { placement: { ...common(), audience: 'adults' } });
  const result = await adult.post('/api/notes', {
    title: 'Заметка об объекте',
    object: { type: 'object', id: object.id },
  });
  expect(result.status, result.text).toBe(201);
  expect(result.json<{ spaceId: string; audience: string }>()).toMatchObject({
    spaceId: world.houseId,
    audience: 'adults',
  });
  const denied = await child.post('/api/notes', {
    title: 'Невидимый объект',
    object: { type: 'object', id: object.id },
  });
  expect(denied.status).toBe(404);
});
it('смена аудитории, корзина и восстановление сохраняют событие, скрытое снимком личного', async () => {
  const object = await create();
  const manual = await event(object.id);
  expect((await adult.post(`${url(object.id)}/share`, common())).status).toBe(200);
  expect(
    (await admin.get(`${url(object.id)}/timeline`))
      .json<Page>()
      .items.some((item) => item.id === manual.id),
  ).toBe(false);
  const narrowed = await admin.post(`${url(object.id)}/audience`, {
    audience: 'adults',
    confirmed: true,
  });
  expect(narrowed.status, narrowed.text).toBe(200);
  expect((await admin.post(`${url(object.id)}/trash`, {})).status).toBe(200);
  const deleted = await world.database.admin.query(
    'SELECT audience,deleted_at FROM object_events WHERE id=$1',
    [manual.id],
  );
  expect(deleted.rows[0].audience).toBe('adults');
  expect(deleted.rows[0].deleted_at).not.toBeNull();
  expect((await admin.post(`${url(object.id)}/restore`, {})).status).toBe(200);
  expect(
    (await adult.get(`${url(object.id)}/timeline`))
      .json<Page>()
      .items.some((item) => item.id === manual.id),
  ).toBe(true);
  expect(
    (await admin.get(`${url(object.id)}/timeline`))
      .json<Page>()
      .items.some((item) => item.id === manual.id),
  ).toBe(false);
});
it('OBJ-1: достаточно названия, тип и свои поля сохраняются с порядком', async () => {
  const object = await create(adult, {
    objectType: 'property',
    fields: [
      { name: 'Адрес', value: 'Вымышленная улица, 7' },
      { name: 'Ключ', value: 'Синий' },
    ],
  });
  expect(object.spaceKind).toBe('personal');
  expect(object.authorId).toBe(world.boris.id);
  expect(object.fields.map((f) => f.position)).toEqual([0, 1]);
  const response = await patch(adult, object.id, {
    title: 'Новый объект',
    fields: [{ id: object.fields[1]?.id, name: 'Ключ', value: 'Красный' }],
  });
  expect(response.status).toBe(200);
  const updated = response.json<Card>();
  expect(updated.fields).toHaveLength(1);
  expect(updated.fields[0]?.value).toBe('Красный');
  expect((await adult.get(url(object.id))).json<Card>().title).toBe('Новый объект');
});
it('администратор, второй взрослый и ребёнок не видят чужое личное ни по id, ни в списке, ленте и экспорте', async () => {
  const object = await create();
  await event(object.id);
  for (const device of [second, child, admin]) {
    expect((await device.get(url(object.id))).status).toBe(404);
    expect((await device.get(`${url(object.id)}/timeline`)).status).toBe(404);
    expect(
      (await device.get('/api/objects')).json<Card[]>().some((row) => row.id === object.id),
    ).toBe(false);
    expect(JSON.stringify((await device.get('/api/objects/export')).json())).not.toContain(
      object.id,
    );
  }
});
it('ребёнок создаёт своё личное, читает семейное; не пишет общий объект и не видит «Взрослые»', async () => {
  await create(child);
  const shared = await create(adult, { placement: common() });
  const adults = await create(adult, { placement: { ...common(), audience: 'adults' } });
  expect((await child.get(url(shared.id))).status).toBe(200);
  expect((await patch(child, shared.id, { title: 'Подмена' })).status).toBe(403);
  expect((await child.post('/api/objects', { title: 'В общее', placement: common() })).status).toBe(
    403,
  );
  expect((await child.get(url(adults.id))).status).toBe(404);
});
it('перенос, подтверждение, список теряющих доступ и каскад своих полей', async () => {
  const object = await create(adult, { fields: [{ name: 'Поле', value: 'Значение' }] });
  const manual = await event(object.id);
  expect((await adult.post(`${url(object.id)}/share`, common())).status).toBe(200);
  const preview = await adult.post(`${url(object.id)}/access-preview`, { action: 'personal' });
  expect(preview.status).toBe(200);
  expect(preview.json<{ losesAccess: unknown[] }>().losesAccess).toHaveLength(3);
  expect((await adult.post(`${url(object.id)}/personal`, {})).json().code).toBe(
    'CONFIRMATION_REQUIRED',
  );
  expect((await adult.post(`${url(object.id)}/personal`, { confirmed: true })).status).toBe(200);
  expect((await admin.get(url(object.id))).status).toBe(404);
  const rows = await world.database.admin.query(
    'SELECT space_kind FROM object_fields WHERE parent_id=$1 UNION ALL SELECT space_kind FROM object_events WHERE id=$2',
    [object.id, manual.id],
  );
  expect(rows.rows.every((row) => row.space_kind === 'personal')).toBe(true);
});
it('служебные изменения не считаются вкладом; чужое поле и событие запрещают сделать личной', async () => {
  const object = await create(adult, { placement: common() });
  expect(
    (await second.post(`${url(object.id)}/audience`, { audience: 'adults', confirmed: true }))
      .status,
  ).toBe(200);
  expect((await adult.post(`${url(object.id)}/personal`, { confirmed: true })).status).toBe(200);
  for (const kind of ['field', 'event']) {
    const shared = await create(adult, { placement: common() });
    if (kind === 'field')
      expect(
        (
          await patch(second, shared.id, {
            fields: [{ name: 'Чужой вклад', value: 'Сохраняется' }],
          })
        ).status,
      ).toBe(200);
    else await event(shared.id, second);
    expect((await adult.post(`${url(shared.id)}/personal`, { confirmed: true })).status).toBe(403);
    const copied = await child.post(`${url(shared.id)}/copy`, {});
    expect(copied.status).toBe(201);
    expect(copied.json<Card>().authorId).toBe(world.vera.id);
  }
});
it('OBJ-2: связь с личным видна только владельцу; скрытый и отсутствующий конец дают одинаковый ответ', async () => {
  const shared = await create(adult, { placement: common() });
  const mine = await create(child);
  const result = await child.post('/api/links', {
    left: { type: 'object', id: shared.id },
    right: { type: 'object', id: mine.id },
    role: 'Моё',
  });
  expect(result.status, result.text).toBe(201);
  const link = result.json<{ id: string }>();
  expect(
    (await child.get(`/api/records/object/${shared.id}/links`)).json<unknown[]>(),
  ).toHaveLength(1);
  for (const device of [adult, second, admin]) {
    expect(
      (await device.get(`/api/records/object/${shared.id}/links`)).json<unknown[]>(),
    ).toHaveLength(0);
    expect(
      (await device.request('PATCH', `/api/links/${link.id}`, { json: { role: 'Подмена' } }))
        .status,
    ).toBe(404);
  }
  const hidden = await create();
  const failures = [];
  for (const id of [hidden.id, randomUUID()]) {
    const response = await child.post('/api/links', {
      left: { type: 'object', id: shared.id },
      right: { type: 'object', id },
    });
    expect(response.status).toBe(404);
    failures.push(response.json());
  }
  expect(failures[0]).toEqual(failures[1]);
});
it('лента ребёнка начинается с открытой аудитории, скрывает старые ручные события и историю', async () => {
  const object = await create(adult, {
    title: 'Прежнее закрытое название',
    placement: { ...common(), audience: 'adults' },
    fields: [{ name: 'Прежнее закрытое поле', value: 'Закрыто' }],
  });
  await event(object.id, adult, { text: 'Прежнее закрытое событие' });
  expect((await patch(adult, object.id, { title: 'Открытое название', fields: [] })).status).toBe(
    200,
  );
  expect((await adult.post(`${url(object.id)}/audience`, { audience: 'household' })).status).toBe(
    200,
  );
  const visible = await event(object.id, adult, {
    text: 'Новое семейное событие',
    amountKopecks: 12345,
    rating: 5,
  });
  const response = await child.get(`${url(object.id)}/timeline`);
  expect(response.status, response.text).toBe(200);
  expect(JSON.stringify(response.json())).not.toContain('Прежнее закрытое');
  expect(response.json<Page>().items.some((item) => item.id === visible.id)).toBe(true);
  expect((await adult.get(`${url(object.id)}/timeline`)).json<Page>().items.length).toBeGreaterThan(
    response.json<Page>().items.length,
  );
});
it('курсор ленты не теряет события с одинаковой датой и не повторяет их', async () => {
  const object = await create(adult, { placement: common() });
  for (let i = 0; i < 4; i++) await event(object.id, adult, { text: `Событие ${i}` });
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const response = await adult.get(
      `${url(object.id)}/timeline?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
    );
    expect(response.status, response.text).toBe(200);
    const page = response.json<Page>();
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  const all = (await adult.get(`${url(object.id)}/timeline`)).json<Page>();
  expect(ids).toEqual(all.items.map((item) => item.id));
  expect(new Set(ids).size).toBe(ids.length);
});
it('ручные события сохраняют копейки, дату и оценку; отдельная корзина и восстановление', async () => {
  const object = await create();
  const manual = await event(object.id, adult, { amountKopecks: -1099, rating: 4 });
  expect(manual.amountKopecks).toBe(-1099);
  expect(manual.occurredOn).toBe('2026-10-06');
  const changed = await adult.request('PATCH', `${url(object.id)}/events/${manual.id}`, {
    json: { text: 'Исправленное событие', amountKopecks: 2000 },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await adult.post(`${url(object.id)}/events/${manual.id}/trash`, {})).status).toBe(200);
  expect((await adult.get(`${url(object.id)}/timeline`)).json<Page>().items).toHaveLength(0);
  expect((await adult.post(`${url(object.id)}/events/${manual.id}/restore`, {})).status).toBe(200);
  expect((await adult.get(`${url(object.id)}/timeline`)).json<Page>().items).toHaveLength(1);
});
it('невидимый контакт скрывает событие, его связи и копию; отказ не раскрывает существование контакта', async () => {
  const object = await create(adult, { placement: common() });
  const contact = await create();
  const manual = await event(object.id, adult, {
    text: 'Закрытое упоминание контакта',
    contact: { type: 'object', id: contact.id },
  });
  const link = await adult.post('/api/links', {
    left: { type: 'object', id: object.id },
    right: { type: 'object_event', id: manual.id },
  });
  expect(link.status, link.text).toBe(201);
  for (const device of [child, second, admin]) {
    const page = await device.get(`${url(object.id)}/timeline`);
    expect(JSON.stringify(page.json())).not.toContain(manual.id);
    expect(JSON.stringify(page.json())).not.toContain(contact.id);
    expect((await device.get(`/api/records/object/${object.id}/links`)).json()).toEqual([]);
    const copy = await device.post(`${url(object.id)}/copy`, {});
    expect(copy.status, copy.text).toBe(201);
    expect((await device.get(`${url(copy.json<Card>().id)}/timeline`)).json<Page>().items).toEqual(
      [],
    );
  }
  const failures = [];
  for (const id of [contact.id, randomUUID()]) {
    const response = await second.post(`${url(object.id)}/events`, {
      text: 'Попытка',
      occurredOn: '2026-10-06',
      contact: { type: 'object', id },
    });
    expect(response.status).toBe(404);
    failures.push(response.json());
  }
  expect(failures[0]).toEqual(failures[1]);
});
it('названия, свои поля, тексты событий и подробности ошибки SQL не попадают в журналы', async () => {
  const markers = [
    'PrivateObjectMarker',
    'PrivateFieldMarker',
    'PrivateValueMarker',
    'PrivateEventMarker',
    'PrivateSqlMarker',
  ];
  const object = await create(adult, {
    title: markers[0],
    fields: [{ name: markers[1], value: markers[2] }],
  });
  await event(object.id, adult, { text: markers[3] });
  await adult.get(`${url(object.id)}/timeline?search=${markers[2]}`);
  await adult.get(`/api/objects/${markers[0]}`);
  await world.database.admin.query(
    `CREATE FUNCTION app.test_object_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PrivateSqlMarker'; END; $$`,
  );
  await world.database.admin.query(
    'CREATE TRIGGER objects_test_failure BEFORE UPDATE ON objects FOR EACH ROW EXECUTE FUNCTION app.test_object_failure()',
  );
  try {
    expect((await patch(adult, object.id, { title: markers[0] })).status).toBe(500);
  } finally {
    await world.database.admin.query(
      'DROP TRIGGER objects_test_failure ON objects; DROP FUNCTION app.test_object_failure()',
    );
  }
  const log = [...world.logs, ...world.requestLog].join('\n');
  for (const marker of markers) expect(log).not.toContain(marker);
  expect(log).toContain('Objects request failed');
});
it('корзина родителя переносит поля и события, восстановление возвращает только каскадное удаление', async () => {
  const object = await create(adult, { fields: [{ name: 'Поле', value: 'Значение' }] });
  const separate = await event(object.id);
  const live = await event(object.id);
  await adult.post(`${url(object.id)}/events/${separate.id}/trash`, {});
  await adult.post(`${url(object.id)}/trash`, {});
  expect((await patch(adult, object.id, { title: 'В корзине' })).status).toBe(403);
  expect((await adult.post(`${url(object.id)}/restore`, {})).status).toBe(200);
  const page = (await adult.get(`${url(object.id)}/timeline`)).json<Page>();
  expect(page.items.map((item) => item.id)).toEqual([live.id]);
  expect((await adult.get(url(object.id))).json<Card>().fields).toHaveLength(1);
});
it('Zod отклоняет лишние поля, дробные копейки, неверные даты, слишком много полей и устаревшую правку', async () => {
  for (const body of [
    { title: '' },
    { title: 'Объект', objectType: 'unknown' },
    { title: 'Объект', authorId: world.anna.id },
    { title: 'Объект', fields: Array.from({ length: 51 }, () => ({ name: 'Поле', value: '' })) },
  ])
    expect((await adult.post('/api/objects', body)).status).toBe(400);
  const object = await create();
  for (const body of [
    { amountKopecks: 1.5 },
    { amountKopecks: Number.MAX_SAFE_INTEGER + 1 },
    { rating: 6 },
    { occurredOn: '2026-02-30' },
    { files: [randomUUID()] },
  ])
    expect(
      (
        await adult.post(`${url(object.id)}/events`, {
          occurredOn: '2026-10-06',
          text: 'Событие',
          ...body,
        })
      ).status,
    ).toBe(400);
  expect(
    (
      await patch(adult, object.id, {
        title: 'Новая версия',
        expectedUpdatedAt: '2000-01-01T00:00:00Z',
      })
    ).json().code,
  ).toBe('STALE_VERSION');
  expect((await adult.get(`${url(object.id)}/timeline?cursor=bad`)).status).toBe(400);
});
it('проверка в коде скрывает чужое личное при ослабленной политике базы', async () => {
  const object = await create();
  try {
    await world.database.admin.query('ALTER POLICY objects_select ON objects USING (true)');
    expect((await admin.get(url(object.id))).status).toBe(404);
    expect(
      (await admin.get('/api/objects')).json<Card[]>().some((row) => row.id === object.id),
    ).toBe(false);
    expect(JSON.stringify((await admin.get('/api/objects/export')).json())).not.toContain(
      object.id,
    );
  } finally {
    await world.database.admin.query(
      `ALTER POLICY objects_select ON objects USING (${canViewSql()})`,
    );
  }
});
