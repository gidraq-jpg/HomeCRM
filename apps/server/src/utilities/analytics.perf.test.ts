import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await world.database.admin.query(
    `INSERT INTO objects(space_id,space_kind,author_id,title)
    SELECT $1,'personal',$2,'Вымышленный объект '||i FROM generate_series(1,500) i`,
    [world.boris.personalSpaceId, world.boris.id],
  );
  await world.database.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,author_id,title,parent_id,data)
    SELECT space_id,space_kind,author_id,'Вымышленный счёт',id,$1::jsonb FROM objects`,
    [
      JSON.stringify({
        transmission: { method: 'gosuslugi_dom' },
        readingRule: {
          kind: 'repeat',
          anchor: '2026-01-01',
          repeat: { unit: 'month', day: 20, endDay: 25 },
        },
      }),
    ],
  );
  await world.database.admin.query(`INSERT INTO utility_charges(space_id,space_kind,author_id,title,parent_id,period,total_cents,due_on)
    SELECT space_id,space_kind,author_id,'Вымышленное начисление',id,'2026-10',10000,'2026-11-01' FROM utility_accounts`);
  await world.database.admin.query(`INSERT INTO utility_payments(space_id,space_kind,author_id,title,parent_id,paid_on,amount_cents,payer,method)
    SELECT space_id,space_kind,author_id,'Вымышленная оплата',id,'2026-10-08',4000,'{"kind":"tenant"}','tenant' FROM utility_charges`);
  await world.database.admin.query(
    `INSERT INTO documents(space_id,space_kind,author_id,title,data)
    SELECT $1,'personal',$2,'Вымышленный документ '||i,'{"type":"contract","indefinite":false,"expiresOn":"2026-10-10"}' FROM generate_series(1,500) i`,
    [world.boris.personalSpaceId, world.boris.id],
  );
  await world.database.worker.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id)
    SELECT id,'2026-10-10','2026-10-09T19:00Z','2026-10-09T19:00Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id FROM deadlines WHERE source_kind='document'`);
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
});
afterAll(async () => world?.close());

it('G4: месяц на 500 объектах и радар 500 документов — один запрос данных, p95 <300 мс', async () => {
  const counts: { execute: number; select: number }[] = [];
  const original = world.module.appDb.withAccount.bind(world.module.appDb);
  const spy = vi.spyOn(world.module.appDb, 'withAccount').mockImplementation((id, fn, options) =>
    original(
      id,
      async (tx) => {
        const execute = vi.spyOn(tx, 'execute');
        const select = vi.spyOn(tx, 'select');
        try {
          return await fn(tx);
        } finally {
          counts.push({ execute: execute.mock.calls.length, select: select.mock.calls.length });
          execute.mockRestore();
          select.mockRestore();
        }
      },
      options,
    ),
  );
  try {
    for (const [url, field] of [
      ['/api/utilities/month?month=2026-10', 'objects'],
      ['/api/deadlines?from=2000-01-01&to=2099-12-31', 'items'],
    ] as const) {
      for (let i = 0; i < 3; i++) await adult.get(url);
      const timings: number[] = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const response = await adult.get(url);
        timings.push(performance.now() - start);
        expect(response.status, response.text).toBe(200);
        expect(response.json<Record<string, unknown[]>>()[field]).toHaveLength(500);
        // Проверка сессии — отдельно; в транзакции данных SET LOCAL jit и один SQL данных.
        expect(counts.at(-1)).toEqual({ execute: 2, select: 0 });
      }
      const p95 = percentile(timings, 0.95);
      console.info(`${url.split('?')[0]}, 500 records: p95=${p95.toFixed(1)} ms`);
      expect(p95).toBeLessThan(300);
    }
  } finally {
    spy.mockRestore();
  }
});
