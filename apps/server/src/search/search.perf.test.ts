// Замеры скорости поиска (PRD, раздел 13: ответ до 300 мс). Идут в проекте perf: после всех остальных
// тестов, по одному файлу, когда компьютер и PostgreSQL не заняты параллельными прогонами.
import { searchAccessKeys, setSearchQuery, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';
import { searchRowsQuery } from './query.ts';

let world: World, child: Device;
const search = async (who: Device, q: string) => {
  const response = await who.get(`/api/search?${new URLSearchParams({ q, scope: 'all' })}`);
  expect(response.status, response.text).toBe(200);
  return response.json<{ total: number }>();
};
beforeAll(async () => {
  world = await createWorld();
  child = world.device();
  await child.signIn(world.vera.username, world.vera.password);
});
afterAll(async () => {
  await world?.close();
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
    return percentile(times, 0.95);
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
}, 120_000);
