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
