import type { PoolClient } from '@homecrm/db';
import { afterAll, expect, it } from 'vitest';
import { seedPerfFamily } from '../testing/family-perf.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World;
afterAll(async () => {
  await world?.close();
});
it('SRCH-5: смешанная семья, 10 000 записей, поиск и ленты p95 ≤300 мс', async () => {
  world = await createWorld();
  await seedPerfFamily(world);
  const adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  let radar: { text: string; values?: unknown[] } | undefined;
  let captured: { text: string; values?: unknown[] } | undefined;
  const clients = new WeakSet<PoolClient>();
  world.database.app.on('acquire', (client: PoolClient) => {
    if (clients.has(client)) return;
    clients.add(client);
    const original = client.query;
    client.query = function (this: PoolClient, ...args: unknown[]) {
      const q = args[0] as { text?: string; values?: unknown[] };
      if (q?.text?.includes('from "tasks"') && q.text.includes('ORDER BY l.created_at'))
        captured = { text: q.text, values: args[1] as unknown[] };
      if (q?.text?.includes('WITH visible_deadlines'))
        radar = { text: q.text, values: args[1] as unknown[] };
      return Reflect.apply(original, this, args);
    } as typeof client.query;
  });
  for (const url of [
    '/api/search?q=ремонт',
    '/api/search?q=р',
    '/api/search?q=семейный%20ремонт',
    '/api/tasks/today',
    '/api/tasks/plan?days=14',
    '/api/deadlines?from=2000-01-01&to=2099-12-31',
  ]) {
    const times: number[] = [];
    for (let i = 0; i < 35; i++) {
      const start = performance.now(),
        response = await adult.get(url);
      if (i >= 5) times.push(performance.now() - start);
      expect(response.status, response.text).toBe(200);
    }
    const p95 = percentile(times, 0.95);
    console.info(`D23a ${url}: p95=${p95.toFixed(1)} ms`);
    expect.soft(p95).toBeLessThanOrEqual(url === '/api/tasks/today' ? 210 : 300);
    if (url === '/api/tasks/today' && captured) {
      const client = await world.database.app.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.account_id',$1,true)", [world.boris.id]);
        await client.query(
          "SELECT set_config('jit','off',true),set_config('enable_nestloop','off',true)",
        );
        const plan = await client.query(
          `EXPLAIN (ANALYZE, BUFFERS) ${captured.text}`,
          captured.values,
        );
        console.info(
          `D23a Today EXPLAIN ANALYZE:\n${plan.rows
            .map((r) => r['QUERY PLAN'])
            .filter((line: string) => /Scan on tasks|Planning Time|Execution Time/.test(line))
            .join('\n')}`,
        );
        if (radar) {
          const rp = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${radar.text}`, radar.values);
          console.info(
            `D23a Radar EXPLAIN ANALYZE:\n${rp.rows
              .map((r) => r['QUERY PLAN'])
              .filter((line: string) => /Planning Time|Execution Time/.test(line))
              .join('\n')}`,
          );
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  }
}, 120000);
