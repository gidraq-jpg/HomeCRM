import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWorkerDatabase } from '@homecrm/db';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { enqueueDeadlineWarnings, initializeHouseTimeZones, refreshDeadlines } from './engine.ts';

let world: World, adult: Device, admin: Device, child: Device;
const now = new Date('2026-10-07T04:00:00Z');
const rule = { kind: 'date', date: '2026-10-10', time: '09:00', warnings: [3] };
beforeEach(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterEach(async () => {
  await world?.close();
});
async function create(common = false, source: 'notes' | 'objects' = 'notes', author = adult) {
  const parent = await adult.post(`/api/${source}`, {
    title: 'Вымышленный источник R0.8c',
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(parent.status, parent.text).toBe(201);
  const sourceId = parent.json<{ id: string }>().id;
  const result = await author.post(`/api/${source}/${sourceId}/deadlines`, { rule });
  expect(result.status, result.text).toBe(201);
  return { sourceId, id: result.json<{ id: string }>().id, source };
}
it('DELETE немедленный; restore проверяет владельца срока и живой источник, корзина не раскрывает чужое личное', async () => {
  for (const source of ['notes', 'objects'] as const) {
    const item = await create(false, source);
    expect((await adult.request('DELETE', `/api/deadlines/${item.id}`)).status).toBe(200);
    const trash = (await adult.get('/api/deadlines/trash')).json<
      { id: string; title: string; canRestore: boolean }[]
    >();
    expect(trash).toContainEqual(
      expect.objectContaining({
        id: item.id,
        title: 'Вымышленный источник R0.8c',
        canRestore: true,
      }),
    );
    expect((await admin.get('/api/deadlines/trash')).text).not.toContain(item.id);
    expect((await admin.post(`/api/deadlines/${item.id}/restore`, {})).status).toBe(404);
    expect((await adult.post(`/api/deadlines/${item.id}/restore`, {})).status).toBe(200);
    const other = await create(true, source, admin);
    expect((await adult.request('DELETE', `/api/deadlines/${other.id}`)).status).toBe(200);
    expect((await adult.post(`/api/deadlines/${other.id}/restore`, {})).status).toBe(403);
    expect((await child.post(`/api/deadlines/${other.id}/restore`, {})).status).toBe(403);
    expect((await admin.post(`/api/deadlines/${other.id}/restore`, {})).status).toBe(200);
    expect((await adult.post(`/api/${source}/${other.sourceId}/trash`, {})).status).toBe(200);
    const trashed = (await admin.get('/api/deadlines/trash')).json<
      { id: string; canRestore: boolean }[]
    >();
    expect(trashed.find((x) => x.id === other.id)?.canRestore).toBe(false);
    expect((await admin.post(`/api/deadlines/${other.id}/restore`, {})).status).toBe(403);
  }
});
it('личный срок редактируется после ухода, общие правила и наступления передаются reassign_responsibility()', async () => {
  const personal = await create();
  const common = await create(true, 'objects');
  const db = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(db, now);
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
    [world.houseId, world.boris.id],
  );
  expect(
    (
      await adult.request('PATCH', `/api/deadlines/${personal.id}`, {
        json: { rule: { ...rule, date: '2026-10-11' } },
      })
    ).status,
  ).toBe(200);
  await world.database.worker.query('SELECT app.reassign_responsibility()');
  const meta = await world.database.admin.query(
    'SELECT d.assignee_id,o.assignee_id AS occurrence_assignee FROM deadlines d JOIN deadline_occurrences o ON o.deadline_id=d.id WHERE d.id=$1',
    [common.id],
  );
  expect(meta.rows).toEqual([{ assignee_id: world.anna.id, occurrence_assignee: world.anna.id }]);
});
it('добавленное предупреждение не досылает прошлое, уже рассчитанное переживает простой; completed_at worker не меняет', async () => {
  const item = await create(),
    db = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(db, now);
  expect(
    (
      await adult.request('PATCH', `/api/deadlines/${item.id}`, {
        json: { rule: { ...rule, warnings: [3, 7] } },
      })
    ).status,
  ).toBe(200);
  await refreshDeadlines(db, new Date('2026-10-08T04:00:00Z'));
  await enqueueDeadlineWarnings(db, new Date('2026-10-08T04:00:00Z'));
  const result = await world.database.admin.query(
    'SELECT o.id,o.warnings_at,n.warning_at FROM deadline_occurrences o JOIN deadline_notifications n ON n.occurrence_id=o.id WHERE o.deadline_id=$1',
    [item.id],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0].warnings_at).toEqual(['2026-10-07T04:00:00.000Z']);
  await expect(
    world.database.worker.query('UPDATE deadline_occurrences SET completed_at=now() WHERE id=$1', [
      result.rows[0].id,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await world.database.admin.query('UPDATE deadline_occurrences SET completed_at=$2 WHERE id=$1', [
    result.rows[0].id,
    now,
  ]);
  await refreshDeadlines(db, now, true);
  expect(
    (
      await world.database.admin.query(
        'SELECT completed_at FROM deadline_occurrences WHERE id=$1',
        [result.rows[0].id],
      )
    ).rows[0].completed_at,
  ).toEqual(now);
});
it('worker без VAPID стартует и пересчитывает сроки, одна строка сообщает об отключённой отправке', async () => {
  const item = await create();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL_WORKER: world.database.worker.options.connectionString,
  };
  delete env.VAPID_PUBLIC_KEY;
  delete env.VAPID_PRIVATE_KEY;
  delete env.VAPID_SUBJECT;
  const worker = spawn(process.execPath, ['apps/server/src/worker.ts'], {
    cwd: new URL('../../../..', import.meta.url),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  worker.stdout.on('data', (chunk) => {
    log += String(chunk);
  });
  worker.stderr.on('data', (chunk) => {
    log += String(chunk);
  });
  try {
    await vi.waitFor(
      async () => {
        expect(worker.exitCode).toBeNull();
        expect(
          (
            await world.database.admin.query('SELECT needs_refresh FROM deadlines WHERE id=$1', [
              item.id,
            ])
          ).rows[0].needs_refresh,
        ).toBe(false);
      },
      { timeout: 20_000, interval: 100 },
    );
    expect(log.match(/Push delivery disabled/g)).toHaveLength(1);
  } finally {
    if (worker.exitCode === null) {
      const done = once(worker, 'exit');
      worker.kill();
      await done;
    }
  }
}, 30_000);
