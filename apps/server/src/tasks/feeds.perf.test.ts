import type { PoolClient } from '@homecrm/db';
import { localDate } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World,
  adult: Device,
  queries = 0;
const clients = new WeakSet<PoolClient>();
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
  world.database.app.on('acquire', (client: PoolClient) => {
    if (clients.has(client)) return;
    clients.add(client);
    const original = client.query;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      queries++;
      return Reflect.apply(original, this, args);
    } as typeof client.query;
  });
});
afterAll(async () => {
  await world?.close();
});
async function seed(count: number) {
  const today = localDate(new Date(), 'Asia/Yekaterinburg');
  await world.database.admin.query(
    `INSERT INTO tasks(space_id,space_kind,author_id,assignee_id,title,household_id,plan_on,repeat_rule) SELECT $1,'personal',$2,$2,'Вымышленное дело замера '||i,$3,$4::date,CASE WHEN i%2=0 THEN '{"kind":"daily"}'::jsonb END FROM generate_series(1,$5) i`,
    [world.boris.personalSpaceId, world.boris.id, world.houseId, today, count],
  );
  await world.database.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id) SELECT d.id,(d.rule->>'date')::date,($1::date::timestamp AT TIME ZONE 'Asia/Yekaterinburg'),($1::date::timestamp AT TIME ZONE 'Asia/Yekaterinburg'),'Asia/Yekaterinburg','[]',d.space_id,d.space_kind,d.author_id,d.assignee_id FROM deadlines d WHERE d.task_id IS NOT NULL ON CONFLICT(deadline_id,date) DO NOTHING`,
    [today],
  );
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
}
it('TASK-4/5/6: 1000 дел, ленты и радар p95 <300 мс; число SQL не растёт с размером списка', async () => {
  await seed(100);
  const counts = new Map<string, number>();
  const urls = ['/api/tasks/today', '/api/tasks/plan?days=14', '/api/tasks?limit=100'];
  for (const url of urls) {
    queries = 0;
    const r = await adult.get(url);
    expect(r.status, r.text).toBe(200);
    counts.set(url, queries);
  }
  await seed(900);
  for (const url of [...urls, '/api/deadlines?from=2000-01-01&to=2099-12-31']) {
    for (let i = 0; i < 3; i++) await adult.get(url);
    const timings = [];
    for (let i = 0; i < 20; i++) {
      queries = 0;
      const started = performance.now(),
        r = await adult.get(url);
      timings.push(performance.now() - started);
      expect(r.status, r.text).toBe(200);
      if (counts.has(url)) expect(queries).toBe(counts.get(url));
      if (url === '/api/tasks/today')
        expect(r.json<{ tasks: unknown[] }>().tasks).toHaveLength(1000);
    }
    const p95 = percentile(timings, 0.95);
    console.info(`Tasks feed ${url.split('?')[0]}: p95=${p95.toFixed(1)} ms, SQL=${queries}`);
    expect(p95).toBeLessThan(300);
  }
}, 120000);
