import { randomUUID } from 'node:crypto';
import { sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { percentile } from '../testing/perf.ts';
import { baselineRadar } from '../testing/radar-baseline.ts';
import { createWorld, type World } from '../testing/world.ts';
import { readRadar } from './routes.ts';

let world: World, adult: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
  for (const table of ['notes', 'objects'] as const) {
    await world.database.admin.query(
      `INSERT INTO ${table}(space_id,space_kind,author_id,title) SELECT $1,'personal',$2,'Вымышленный замер '||i FROM generate_series(1,500) i`,
      [world.boris.personalSpaceId, world.boris.id],
    );
    await world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx.execute(
        sql.raw(
          `INSERT INTO deadlines(${table === 'notes' ? 'note_id' : 'object_id'},household_id,rule,space_id,space_kind,author_id,assignee_id) SELECT id,'${world.houseId}','{"kind":"date","date":"2026-10-10"}','${world.boris.personalSpaceId}','personal','${world.boris.id}','${world.boris.id}' FROM ${table}`,
        ),
      ),
    );
  }
  await world.database.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id) SELECT id,'2026-10-10','2026-10-09T19:00Z','2026-10-10T18:59:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id FROM deadlines`,
  );
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
});
afterAll(async () => world?.close());
it('одни 1000 источников: f065fc6 → текущий агрегат, фильтры и действия; p95 < 300 мс', async () => {
  const from = '2000-01-01',
    to = '2099-12-31';
  const runOld = () =>
    world.module.appDb.withAccount(world.boris.id, (tx) => baselineRadar(tx, from, to));
  const runNew = () =>
    world.module.appDb.withAccount(world.boris.id, (tx) => readRadar(tx, from, to));
  for (let i = 0; i < 3; i++) {
    await runOld();
    await runNew();
  }
  const before: number[] = [],
    after: number[] = [],
    filters: number[] = [],
    actions: number[] = [];
  const first = (await runNew()).items[0];
  if (!first) throw new Error('Missing benchmark source');
  let version = 0;
  for (let i = 0; i < 20; i++) {
    let started = performance.now();
    const old = await runOld();
    before.push(performance.now() - started);
    started = performance.now();
    const current = await runNew();
    after.push(performance.now() - started);
    expect(current.items.map((x) => x.id).sort()).toEqual(old.items.map((x) => x.id).sort());
    started = performance.now();
    const filtered = await world.module.appDb.withAccount(world.boris.id, (tx) =>
      readRadar(tx, from, to, {
        householdId: world.houseId,
        personId: world.boris.id,
        view: 'mine',
        scope: 'personal',
      }),
    );
    filters.push(performance.now() - started);
    expect(filtered.items).toHaveLength(1000);
    started = performance.now();
    const saved = await adult.post(`/api/deadlines/occurrences/${first.id}/action`, {
      action: 'restore',
      calendarKey: first.calendarKey,
      expectedVersion: version++,
      idempotencyKey: randomUUID(),
    });
    actions.push(performance.now() - started);
    expect(saved.status, saved.text).toBe(200);
  }
  const report = {
    baseline: percentile(before, 0.95),
    current: percentile(after, 0.95),
    filters: percentile(filters, 0.95),
    actions: percentile(actions, 0.95),
  };
  console.info(`R1c.5-6 same database/1000 sources p95 ms: ${JSON.stringify(report)}`);
  for (const value of Object.values(report)) expect(value).toBeLessThan(300);
});
