// Замер радара сроков (PRD, раздел 13: до 300 мс). Идёт в проекте perf: после остальных тестов и по одному файлу.
import { sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { percentile } from '../testing/perf.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device;
const rule = { kind: 'date', date: '2026-10-10', time: '09:00', warnings: [3] };
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  admin = (await signedInAdmin(world)).device;
});
afterAll(async () => {
  await world?.close();
});
it('радар на 500 заметках и 500 объектах: названия под RLS, один HTTP-запрос, сервер p95 до 300 мс', async () => {
  const ids: string[] = [];
  for (const source of ['notes', 'objects'] as const) {
    const seeded = await world.database.admin.query(
      `INSERT INTO ${source}(space_id,space_kind,author_id,title)
      SELECT $1,'personal',$2,'Вымышленный радар '||i FROM generate_series(1,500) i RETURNING id`,
      [world.boris.personalSpaceId, world.boris.id],
    );
    const sourceIds = seeded.rows.map((x) => x.id as string);
    const values = await world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx.execute<{ id: string }>(
        sql.raw(`INSERT INTO deadlines(${source === 'notes' ? 'note_id' : 'object_id'},household_id,rule,space_id,space_kind,author_id,assignee_id)
      SELECT id,'${world.houseId}','${JSON.stringify(rule)}','${world.boris.personalSpaceId}','personal','${world.boris.id}','${world.boris.id}' FROM ${source} WHERE id=ANY(ARRAY[${sourceIds.map((id) => `'${id}'::uuid`).join(',')}]) RETURNING id`),
      ),
    );
    ids.push(...values.rows.map((x) => x.id));
  }
  await world.database.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id)
    SELECT id,'2026-10-10','2026-10-10T04:00:00Z','2026-10-10T04:00:00Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id FROM deadlines WHERE id=ANY($1::uuid[])`,
    [ids],
  );
  await world.database.worker.query(
    'UPDATE deadlines SET needs_refresh=false WHERE id=ANY($1::uuid[])',
    [ids],
  );
  const url = '/api/deadlines?from=2000-01-01&to=2099-12-31';
  // Разогрев: первые запросы компилируют планы и прогревают кэши, а не показывают обычную скорость.
  for (let i = 0; i < 3; i++) await adult.get(url);
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const response = await adult.get(url);
    timings.push(performance.now() - start);
    expect(response.status, response.text).toBe(200);
    const items = response.json<{
      items: {
        deadlineId: string;
        title: string;
        noteId: string | null;
        objectId: string | null;
      }[];
    }>().items;
    expect(items.filter((x) => ids.includes(x.deadlineId))).toHaveLength(1000);
    expect(items.every((x) => x.title && (x.noteId || x.objectId))).toBe(true);
  }
  const p95 = percentile(timings, 0.95);
  console.info(
    `Radar 1000 sources, server response: p95=${p95.toFixed(1)} ms, median=${percentile(timings, 0.5).toFixed(1)} ms, max=${Math.max(...timings).toFixed(1)} ms`,
  );
  expect(p95).toBeLessThan(300);
  const hidden = (await admin.get(url)).text;
  expect(ids.every((id) => !hidden.includes(id))).toBe(true);
  expect(hidden).not.toContain('Вымышленный радар');
}, 120_000);
it('UTIL-13: радар 500 коммунальных объектов и 1000 сроков одним ответом, p95 до 300 мс', async () => {
  await world.database.admin.query('DELETE FROM deadlines');
  const parentIds = (
    await world.database.admin.query(
      `INSERT INTO objects(space_id,space_kind,author_id,title,object_type,type_data)
    SELECT $1,'personal',$2,'Вымышленная коммуналка '||i,'property','{"status":"rented"}' FROM generate_series(1,500) i RETURNING id`,
      [world.boris.personalSpaceId, world.boris.id],
    )
  ).rows.map((r) => r.id);
  const reading = {
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day: 10, endDay: 12 },
  };
  const payment = { kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 10 } };
  await world.database.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,author_id,title,parent_id,data)
    SELECT space_id,space_kind,author_id,'Вымышленный счёт',id,$2::jsonb FROM objects WHERE id=ANY($1::uuid[])`,
    [parentIds, JSON.stringify({ readingRule: reading, paymentRule: payment })],
  );
  await world.database.admin.query(
    `INSERT INTO meters(space_id,space_kind,author_id,title,parent_id,utility_account_id)
    SELECT space_id,space_kind,author_id,'Вымышленный прибор',parent_id,id FROM utility_accounts WHERE parent_id=ANY($1::uuid[])`,
    [parentIds],
  );
  await world.database.worker.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id)
    SELECT id,'2026-10-10','2026-10-09T19:00:00Z','2026-10-12T18:59:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id FROM deadlines WHERE source_kind<>'record'`);
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
  const url = '/api/deadlines?from=2000-01-01&to=2099-12-31';
  for (let i = 0; i < 3; i++) await adult.get(url);
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const response = await adult.get(url);
    timings.push(performance.now() - start);
    expect(response.status, response.text).toBe(200);
    const items = response.json<{
      items: { sourceKind: string; object: { status: string }; utilityAccount: { id: string } }[];
    }>().items;
    expect(items).toHaveLength(1000);
    expect(items.every((r) => r.object.status === 'rented' && r.utilityAccount.id)).toBe(true);
  }
  const p95 = percentile(timings, 0.95);
  console.info(`Utility radar 1000 deadlines: p95=${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThan(300);
  expect((await admin.get(url)).json<{ items: unknown[] }>().items).toEqual([]);
}, 120_000);

it('UTIL-9/10: 500 частично оплаченных начислений заменяют сроки счетов, p95 до 300 мс', async () => {
  await world.database.admin.query('DELETE FROM deadline_occurrences');
  await world.database.admin.query(`INSERT INTO utility_charges(space_id,space_kind,author_id,title,parent_id,period,total_cents,due_on)
    SELECT space_id,space_kind,author_id,'Вымышленное начисление',id,'2026-09',10000,'2026-10-10' FROM utility_accounts`);
  await world.database.admin.query(`INSERT INTO utility_payments(space_id,space_kind,author_id,title,parent_id,paid_on,amount_cents,payer,method)
    SELECT space_id,space_kind,author_id,'Вымышленная оплата',id,'2026-10-08',4000,'{"kind":"tenant"}','tenant' FROM utility_charges`);
  await world.database.worker.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id)
    SELECT id,'2026-10-10','2026-10-09T19:00:00Z','2026-10-12T18:59:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id FROM deadlines WHERE source_kind<>'record'`);
  await world.database.worker.query('UPDATE deadlines SET needs_refresh=false');
  const url = '/api/deadlines?from=2000-01-01&to=2099-12-31';
  for (let i = 0; i < 3; i++) await adult.get(url);
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const response = await adult.get(url);
    timings.push(performance.now() - start);
    expect(response.status, response.text).toBe(200);
    const items = response.json<{ items: { chargeId: string | null; sourceKind: string }[] }>()
      .items;
    expect(items).toHaveLength(1000);
    expect(items.filter((r) => r.chargeId)).toHaveLength(500);
    expect(items.filter((r) => r.sourceKind === 'readings')).toHaveLength(500);
  }
  const p95 = percentile(timings, 0.95);
  console.info(`Charges radar 1000 deadlines: p95=${p95.toFixed(1)} ms`);
  expect(p95).toBeLessThan(300);
  expect((await admin.get(url)).json<{ items: unknown[] }>().items).toEqual([]);
}, 120_000);
