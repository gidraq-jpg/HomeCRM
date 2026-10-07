import { searchAccessKeys, setSearchQuery, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';
import { searchRowsQuery } from './query.ts';

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
it('SRCH-5: 10 000 вымышленных записей, API p95 < 300 мс, план использует индексы; скрытые совпадения не дают заметной задержки', async () => {
  await world.database.admin.query(
    `INSERT INTO notes(space_id,space_kind,audience,author_id,title,body)
    SELECT $1,'household','household',$2,'Вымышленная запись '||n,
      CASE WHEN n%500=0 THEN 'спектрометр 88005678' ELSE 'обычный текст '||n END FROM generate_series(1,10000) n`,
    [world.houseId, world.boris.id],
  );
  await world.database.admin.query('ANALYZE search_index');
  const measure = async (q: string) => {
    const times: number[] = [];
    for (let i = 0; i < 35; i++) {
      const start = performance.now();
      await search(child, q);
      if (i >= 5) times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1] ?? Infinity;
  };
  const p95 = await measure('спектрометр');
  expect(p95).toBeLessThan(300);
  const plan = await world.module.appDb.withAccount(world.vera.id, async (tx) => {
    await setSearchQuery(tx, 'спектрометр');
    const keys = await searchAccessKeys(tx, {
      accountId: world.vera.id,
      memberships: new Map([[world.houseId, 'child']]),
    });
    return (
      await tx.execute(
        sql`EXPLAIN (ANALYZE,BUFFERS) ${searchRowsQuery('спектрометр', 'all', keys)}`,
      )
    ).rows;
  });
  const text = JSON.stringify(plan);
  console.info(
    `Search benchmark API p95=${p95.toFixed(1)} ms; plan=${plan
      .filter((row) =>
        /Bitmap|Index Cond|search_index_|Execution Time/.test(String(row['QUERY PLAN'])),
      )
      .map((row) => row['QUERY PLAN'])
      .join('\n')}`,
  );
  expect(text).toMatch(/search_index_(document|content|digits)_idx/);
  const before = await measure('невидимыймаркер');
  await world.database.admin.query(
    `INSERT INTO notes(space_id,space_kind,author_id,title)
    SELECT $1,'personal',$2,'невидимыймаркер 777889900 '||n FROM generate_series(1,10000)n`,
    [world.boris.personalSpaceId, world.boris.id],
  );
  await world.database.admin.query('ANALYZE search_index');
  const hiddenPlan = await world.module.appDb.withAccount(world.vera.id, async (tx) => {
    await setSearchQuery(tx, 'невидимыймаркер');
    const keys = await searchAccessKeys(tx, {
      accountId: world.vera.id,
      memberships: new Map([[world.houseId, 'child']]),
    });
    return (
      await tx.execute(
        sql`EXPLAIN (ANALYZE,BUFFERS) ${searchRowsQuery('невидимыймаркер', 'all', keys)}`,
      )
    ).rows;
  });
  console.info(
    `Search hidden plan: ${hiddenPlan
      .filter((row) => /Scan on search_index|Execution Time/.test(String(row['QUERY PLAN'])))
      .map((row) => row['QUERY PLAN'])
      .join('\n')}`,
  );
  expect((await search(child, 'невидимыймаркер')).total).toBe(0);
  expect((await search(child, '777889900')).total).toBe(0);
  const after = await measure('невидимыймаркер');
  console.info(
    `Search hidden matches API p95: before=${before.toFixed(1)} ms; after=${after.toFixed(1)} ms`,
  );
  expect(after - before).toBeLessThan(30);
}, 60000);
