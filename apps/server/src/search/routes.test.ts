import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device;
interface Results {
  state: string;
  total: number;
  hasMore: boolean;
  groups: {
    type: string;
    items: { id: string; targetId: string; title: string; snippet: string; numbers: string[] }[];
  }[];
}
const search = async (who: Device, q: string, scope = 'all') => {
  const response = await who.get(`/api/search?${new URLSearchParams({ q, scope })}`);
  expect(response.status, response.text).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  return response.json<Results>();
};
const ids = (r: Results) => r.groups.flatMap((g) => g.items.map((item) => item.targetId));
async function note(title: string, body = '', audience?: 'adults' | 'household') {
  const response = await adult.post('/api/notes', {
    title,
    body,
    ...(audience ? { placement: { spaceId: world.houseId, audience } } : {}),
  });
  expect(response.status, response.text).toBe(201);
  return response.json<{ id: string }>();
}
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
});
afterAll(async () => {
  await world?.close();
});
it('пустой, короткий и недопустимый запрос; вход обязателен', async () => {
  expect((await search(adult, '')).state).toBe('empty');
  expect((await search(adult, 'сч')).state).toBe('short');
  expect((await adult.get('/api/search?q=abc&scope=bad')).status).toBe(400);
  expect((await adult.get(`/api/search?q=${'a'.repeat(201)}`)).status).toBe(400);
  expect((await world.device().get('/api/search?q=abc')).status).toBe(401);
});
it('словоформы, часть слова, номер и телефон, группы, фильтр, чек-лист; запросов нет в журнале', async () => {
  const a = await note(
    'Счётчика обслуживание',
    'Телефон +7 (900) 555-01-23, номер 741852963',
    'household',
  );
  const b = await note('Счётчики личные');
  const checklist = await adult.post('/api/notes', {
    title: 'Запасной список',
    checklist: [{ title: 'Счётчиком проверить давление' }],
  });
  expect(checklist.status).toBe(201);
  expect(ids(await search(adult, 'счётчик'))).toEqual(
    expect.arrayContaining([a.id, b.id, checklist.json<{ id: string }>().id]),
  );
  expect(ids(await search(adult, 'обслуж'))).toContain(a.id);
  expect(
    (await search(adult, 'обслуж')).groups
      .flatMap((g) => g.items)
      .some((item) => item.snippet.includes('‹обслуж›')),
  ).toBe(true);
  expect(ids(await search(adult, '185296'))).toContain(a.id);
  const phone = await search(adult, '900555');
  expect(ids(phone)).toContain(a.id);
  expect(phone.groups[0]?.items[0]?.numbers).toContain('+7 (900) 555-01-23');
  expect(ids(await search(adult, 'счётчик', 'personal'))).toContain(b.id);
  expect(ids(await search(adult, 'счётчик', 'personal'))).not.toContain(a.id);
  expect(ids(await search(adult, 'счётчик', 'household'))).not.toContain(b.id);
  expect(ids(await search(child, 'счётчик'))).not.toContain(b.id);
  const log = world.requestLog.join('\n');
  for (const q of ['счётчик', '185296', '900555', encodeURIComponent('счётчик')])
    expect(log).not.toContain(q);
});
it('перенос, аудитория, корзина, восстановление, правка и физическая очистка синхронны', async () => {
  const a = await note('Уникальный термостат 654987', '', 'household');
  expect(ids(await search(child, 'термостат'))).toContain(a.id);
  expect(
    (await adult.post(`/api/notes/${a.id}/audience`, { audience: 'adults', confirmed: true }))
      .status,
  ).toBe(200);
  expect(ids(await search(child, 'термостат'))).not.toContain(a.id);
  expect((await adult.post(`/api/notes/${a.id}/personal`, { confirmed: true })).status).toBe(200);
  expect(ids(await search(child, '654987'))).not.toContain(a.id);
  expect(
    (
      await adult.request('PATCH', `/api/notes/${a.id}`, {
        json: { title: 'Новый терморегулятор 654987' },
      })
    ).status,
  ).toBe(200);
  expect(ids(await search(adult, 'термостат'))).not.toContain(a.id);
  expect((await adult.post(`/api/notes/${a.id}/trash`, {})).status).toBe(200);
  expect(ids(await search(adult, '654987'))).not.toContain(a.id);
  expect((await adult.post(`/api/notes/${a.id}/restore`, {})).status).toBe(200);
  expect(ids(await search(adult, '654987'))).toContain(a.id);
  await world.database.admin.query('DELETE FROM notes WHERE id=$1', [a.id]);
  expect(ids(await search(adult, '654987'))).not.toContain(a.id);
});
it('объекты, поля и ручные события: снимок личного не расширяется вместе с объектом', async () => {
  const response = await adult.post('/api/objects', {
    title: 'Котёл вымышленный',
    fields: [{ name: 'Заводской номер', value: 'XZ-9918873' }],
  });
  expect(response.status).toBe(201);
  const object = response.json<{ id: string }>();
  const event = await adult.post(`/api/objects/${object.id}/events`, {
    text: 'Тайная чистка горелки',
    occurredOn: '2026-10-07',
  });
  expect(event.status).toBe(201);
  expect(
    (
      await adult.post(`/api/objects/${object.id}/share`, {
        spaceId: world.houseId,
        audience: 'household',
      })
    ).status,
  ).toBe(200);
  expect(ids(await search(child, '991887'))).toContain(object.id);
  expect(
    (await search(child, '991887')).groups.flatMap((g) => g.items).flatMap((item) => item.numbers),
  ).toContain('XZ-9918873');
  expect((await search(child, 'горелки')).total).toBe(0);
  expect((await search(adult, 'горелки')).groups[0]?.type).toBe('object_event');
  expect(
    (
      await adult.post(`/api/objects/${object.id}/events`, {
        text: 'Общая замена горелки',
        occurredOn: '2026-10-07',
      })
    ).status,
  ).toBe(201);
  expect((await search(child, 'горелки')).total).toBe(1);
  expect(
    (
      await adult.post(`/api/objects/${object.id}/audience`, {
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await search(child, 'горелки')).total).toBe(0);
  expect((await adult.post(`/api/objects/${object.id}/trash`, {})).status).toBe(200);
  expect((await search(adult, 'горелки')).total).toBe(0);
  expect((await adult.post(`/api/objects/${object.id}/restore`, {})).status).toBe(200);
  expect((await search(adult, 'горелки')).total).toBe(2);
});
