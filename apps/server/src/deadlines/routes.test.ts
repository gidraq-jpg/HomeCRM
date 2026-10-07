import { createWorkerDatabase, sql } from '@homecrm/db';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { enqueueDeadlineWarnings, initializeHouseTimeZones, refreshDeadlines } from './engine.ts';
import { startDeadlineJobs } from './jobs.ts';

let world: World, adult: Device, admin: Device, child: Device;
const now = new Date('2026-10-07T04:00:00Z');
const rule = { kind: 'date', date: '2026-10-10', time: '09:00', warnings: [3] };
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => {
  await world?.close();
});
async function create(source: 'notes' | 'objects' = 'notes', common = false) {
  const parent = await adult.post(`/api/${source}`, {
    title: 'Скрытое вымышленное название',
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(parent.status, parent.text).toBe(201);
  const sourceId = parent.json<{ id: string }>().id;
  const created = await adult.post(`/api/${source}/${sourceId}/deadlines`, { rule });
  expect(created.status, created.text).toBe(201);
  return { id: created.json<{ id: string }>().id, sourceId, source };
}
it('API создаёт сроки объектов и заметок, валидирует правило и закрывает чужое личное', async () => {
  for (const source of ['notes', 'objects'] as const) {
    const item = await create(source);
    expect(
      (await adult.get(`/api/${source}/${item.sourceId}/deadlines`)).json<unknown[]>(),
    ).toHaveLength(1);
    expect((await admin.get(`/api/${source}/${item.sourceId}/deadlines`)).status).toBe(404);
    expect(
      (
        await adult.post(`/api/${source}/${item.sourceId}/deadlines`, {
          rule: { ...rule, date: '2026-02-30' },
        })
      ).status,
    ).toBe(400);
  }
  const common = await create('notes', true);
  expect((await child.post(`/api/notes/${common.sourceId}/deadlines`, { rule })).status).toBe(404);
  expect((await world.device().get('/api/deadlines?from=2026-01-01&to=2027-01-01')).status).toBe(
    401,
  );
});
it('пересчёт сохраняет UUID и выполненные наступления; предупреждение ставится ровно один раз', async () => {
  const item = await create();
  const db = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(db, now);
  await enqueueDeadlineWarnings(db, now);
  const initial = await world.database.admin.query(
    'SELECT * FROM deadline_occurrences WHERE deadline_id=$1',
    [item.id],
  );
  expect(initial.rows).toHaveLength(1);
  const occurrence = initial.rows[0];
  expect(occurrence.starts_at.toISOString()).toBe('2026-10-10T04:00:00.000Z');
  const warnings = () =>
    world.database.admin.query('SELECT * FROM deadline_notifications WHERE occurrence_id=$1', [
      occurrence.id,
    ]);
  expect((await warnings()).rows).toHaveLength(1);
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  expect((await warnings()).rows).toHaveLength(1);
  await world.database.admin.query('UPDATE deadline_occurrences SET completed_at=$2 WHERE id=$1', [
    occurrence.id,
    now,
  ]);
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, now);
  const kept = await world.database.admin.query(
    'SELECT id,completed_at FROM deadline_occurrences WHERE deadline_id=$1',
    [item.id],
  );
  expect(kept.rows[0]).toEqual({ id: occurrence.id, completed_at: now });
  expect((await warnings()).rows[0].status).toBe('cancelled');
});
it('чужое личное не появляется в радаре и счётчиках, а общий срок виден ребёнку', async () => {
  const common = await create('objects', true);
  await create('notes');
  await refreshDeadlines(createWorkerDatabase(world.database.worker), now);
  const get = async (device: Device) =>
    (await device.get('/api/deadlines?from=2026-10-01&to=2026-12-31')).json<{
      items: { deadlineId: string }[];
      groups: Record<string, number>;
    }>();
  const mine = await get(adult),
    theirs = await get(child),
    administrator = await get(admin);
  expect(mine.items.length).toBeGreaterThan(theirs.items.length);
  expect(theirs.items.some((x) => x.deadlineId === common.id)).toBe(true);
  expect(administrator.items.length).toBe(theirs.items.length);
  expect(Object.values(theirs.groups).reduce((a, b) => a + b, 0)).toBe(theirs.items.length);
});
it('правка правила инвалидирует старые даты и пересчитывает предупреждения', async () => {
  const item = await create();
  const db = createWorkerDatabase(world.database.worker);
  await refreshDeadlines(db, now);
  const changed = await adult.request('PATCH', `/api/deadlines/${item.id}`, {
    json: { rule: { ...rule, date: '2026-10-11' } },
  });
  expect(changed.status, changed.text).toBe(200);
  const hidden = await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.execute(sql`SELECT id FROM deadline_occurrences WHERE deadline_id=${item.id}`),
  );
  expect(hidden.rowCount).toBe(0);
  await refreshDeadlines(db, now);
  expect(
    (
      await world.database.admin.query(
        'SELECT date::text FROM deadline_occurrences WHERE deadline_id=$1',
        [item.id],
      )
    ).rows,
  ).toEqual([{ date: '2026-10-11' }]);
});
it('часовой пояс дома сохраняется, меняется только администратором и отдаётся через /api/me', async () => {
  const endpoint = `/api/households/${world.houseId}/time-zone`;
  expect(
    (await adult.request('PATCH', endpoint, { json: { timeZone: 'Europe/Moscow' } })).status,
  ).toBe(403);
  expect(
    (await admin.request('PATCH', endpoint, { json: { timeZone: 'No/SuchZone' } })).status,
  ).toBe(400);
  expect(
    (await admin.request('PATCH', endpoint, { json: { timeZone: 'Europe/Moscow' } })).status,
  ).toBe(200);
  const me = (await adult.get('/api/me')).json<{
    timeZone: string;
    households: { timeZone: string }[];
  }>();
  expect(me.timeZone).toBe('Europe/Moscow');
  expect(me.households[0]?.timeZone).toBe('Europe/Moscow');
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Pacific/Auckland');
  expect((await adult.get('/api/me')).json().timeZone).toBe('Europe/Moscow');
  await refreshDeadlines(createWorkerDatabase(world.database.worker), now, true);
  const { rows } = await world.database.admin.query(
    'SELECT starts_at FROM deadline_occurrences WHERE date=$1 AND completed_at IS NULL',
    ['2026-10-10'],
  );
  expect(rows.map((x) => x.starts_at.toISOString())).toEqual(
    rows.map(() => '2026-10-10T06:00:00.000Z'),
  );
});
it('worker ставит уведомление текущему ответственному только при доступе; после ухода старое отменяется', async () => {
  const item = await create('objects', true),
    db = createWorkerDatabase(world.database.worker);
  await world.module.appDb.withAccount(world.boris.id, (tx) =>
    tx.execute(sql`UPDATE objects SET assignee_id=${world.vera.id} WHERE id=${item.sourceId}`),
  );
  await refreshDeadlines(db, now, true);
  await enqueueDeadlineWarnings(db, new Date('2026-10-07T06:00:00Z'));
  const { rows } = await world.database.admin.query(
    'SELECT recipient_id,status FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id WHERE o.deadline_id=$1',
    [item.id],
  );
  expect(rows).toEqual([{ recipient_id: world.vera.id, status: 'pending' }]);
  // Потеря доступа проверяется заново независимо от наличия уже готовой строки очереди.
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
    [world.houseId, world.vera.id],
  );
  await enqueueDeadlineWarnings(db, new Date('2026-10-07T06:00:00Z'));
  expect(
    (
      await world.database.admin.query(
        'SELECT status FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id WHERE o.deadline_id=$1',
        [item.id],
      )
    ).rows[0].status,
  ).toBe('cancelled');
});
it('pg-boss запускается ролью worker, выполняет пересчёт и переживает повторный запуск', async () => {
  const item = await create();
  const pool = world.database.pool('worker', 4);
  const errors: unknown[] = [];
  let stop: undefined | (() => Promise<void>);
  try {
    stop = await startDeadlineJobs(pool, 'Asia/Yekaterinburg', () => errors.push('failure'));
    await vi.waitFor(
      async () =>
        expect(
          (
            await world.database.admin.query('SELECT needs_refresh FROM deadlines WHERE id=$1', [
              item.id,
            ])
          ).rows[0].needs_refresh,
        ).toBe(false),
      { timeout: 15000, interval: 100 },
    );
    await stop();
    stop = await startDeadlineJobs(pool, 'Asia/Yekaterinburg', () => errors.push('failure'));
    expect(errors).toEqual([]);
  } finally {
    await stop?.();
  }
});
it('журналы не содержат названия источника и правило срока', () => {
  const log = world.requestLog.join('\n');
  expect(log).not.toContain('Скрытое вымышленное название');
  expect(log).not.toContain('warnings');
});
it('DELETE переводит срок в корзину, экспорт сохраняет свои правила и не выдаёт чужое личное', async () => {
  const item = await create();
  const cookie = [...adult.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  const deleted = await world.app.inject({
    method: 'DELETE',
    url: `/api/deadlines/${item.id}`,
    headers: { cookie, origin: 'http://homecrm.test' },
  });
  expect(deleted.statusCode, deleted.body).toBe(200);
  expect(deleted.json().deletedAt).not.toBeNull();
  expect((await adult.get(`/api/notes/${item.sourceId}/deadlines`)).json<unknown[]>()).toEqual([]);
  const mine = await adult.post('/api/export', { password: world.boris.password });
  expect(mine.status, mine.text).toBe(200);
  expect(mine.json<{ deadlines: { id: string }[] }>().deadlines.some((x) => x.id === item.id)).toBe(
    true,
  );
  const theirs = await admin.post('/api/export', { password: world.anna.password });
  expect(theirs.status, theirs.text).toBe(200);
  expect(
    theirs.json<{ deadlines: { id: string }[] }>().deadlines.some((x) => x.id === item.id),
  ).toBe(false);
});
it('чужие добавление, правка и удаление срока запрещают «Сделать личной», копирование доступно', async () => {
  for (const source of ['notes', 'objects'] as const)
    for (const action of ['create', 'edit', 'trash'] as const) {
      const parent = await adult.post(`/api/${source}`, {
        title: 'Вымышленный источник с вкладом',
        placement: { spaceId: world.houseId, audience: 'household' },
      });
      expect(parent.status, parent.text).toBe(201);
      const sourceId = parent.json<{ id: string }>().id;
      const created = await (action === 'create' ? admin : adult).post(
        `/api/${source}/${sourceId}/deadlines`,
        { rule },
      );
      expect(created.status, created.text).toBe(201);
      const id = created.json<{ id: string }>().id;
      if (action === 'edit') {
        const changed = await admin.request('PATCH', `/api/deadlines/${id}`, {
          json: { rule: { ...rule, date: '2026-10-11' } },
        });
        expect(changed.status, changed.text).toBe(200);
      } else if (action === 'trash') {
        const cookie = [...admin.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
        const removed = await world.app.inject({
          method: 'DELETE',
          url: `/api/deadlines/${id}`,
          headers: { cookie, origin: 'http://homecrm.test' },
        });
        expect(removed.statusCode, removed.body).toBe(200);
      }
      expect(
        (
          await world.database.admin.query(
            `SELECT has_other_contributions FROM ${source} WHERE id=$1`,
            [sourceId],
          )
        ).rows[0].has_other_contributions,
      ).toBe(true);
      const moved = await adult.post(`/api/${source}/${sourceId}/personal`, { confirmed: true });
      expect(moved.status, moved.text).toBe(403);
      const copied = await adult.post(`/api/${source}/${sourceId}/copy`, {});
      expect(copied.status, copied.text).toBe(201);
    }
});
it('выполненность наступления не считается чужим вкладом и не блокирует перенос источника', async () => {
  for (const source of ['notes', 'objects'] as const) {
    const item = await create(source, true);
    await refreshDeadlines(createWorkerDatabase(world.database.worker), now);
    await world.database.worker.query(
      'UPDATE deadline_occurrences SET completed_at=now() WHERE deadline_id=$1',
      [item.id],
    );
    expect(
      (
        await world.database.admin.query(
          `SELECT has_other_contributions FROM ${source} WHERE id=$1`,
          [item.sourceId],
        )
      ).rows[0].has_other_contributions,
    ).toBe(false);
    const moved = await adult.post(`/api/${source}/${item.sourceId}/personal`, { confirmed: true });
    expect(moved.status, moved.text).toBe(200);
  }
});
it('возврат ответственности восстанавливает отменённое предупреждение, отправленное не повторяет', async () => {
  const item = await create('notes', true),
    db = createWorkerDatabase(world.database.worker);
  async function run() {
    await refreshDeadlines(db, now, true);
    await enqueueDeadlineWarnings(db, new Date('2026-10-07T12:00:00Z'));
  }
  async function assign(id: string) {
    await world.module.appDb.withAccount(world.boris.id, (tx) =>
      tx.execute(sql`UPDATE notes SET assignee_id=${id} WHERE id=${item.sourceId}`),
    );
    await run();
  }
  const states = async () =>
    (
      await world.database.admin.query(
        'SELECT recipient_id,status FROM deadline_notifications n JOIN deadline_occurrences o ON o.id=n.occurrence_id WHERE o.deadline_id=$1',
        [item.id],
      )
    ).rows;
  await run();
  await assign(world.anna.id);
  expect(await states()).toContainEqual({ recipient_id: world.boris.id, status: 'cancelled' });
  await assign(world.boris.id);
  expect(await states()).toContainEqual({ recipient_id: world.boris.id, status: 'pending' });
  await world.database.worker.query(
    "UPDATE deadline_notifications n SET status='sent' FROM deadline_occurrences o WHERE n.occurrence_id=o.id AND o.deadline_id=$1 AND n.recipient_id=$2",
    [item.id, world.boris.id],
  );
  await run();
  expect(await states()).toContainEqual({ recipient_id: world.boris.id, status: 'sent' });
  expect(await states()).toHaveLength(2);
});
it('давние просроченные повторы сохраняют UUID и пересчитываются после смены пояса дома', async () => {
  const item = await create(),
    db = createWorkerDatabase(world.database.worker);
  const changed = await adult.request('PATCH', `/api/deadlines/${item.id}`, {
    json: {
      rule: {
        kind: 'repeat',
        anchor: '2025-01-01',
        time: '09:00',
        repeat: { unit: 'month', day: 10 },
      },
    },
  });
  expect(changed.status, changed.text).toBe(200);
  await refreshDeadlines(db, new Date('2025-01-01T00:00:00Z'));
  const initial = (
    await world.database.admin.query(
      "SELECT id FROM deadline_occurrences WHERE deadline_id=$1 AND date='2025-01-10'",
      [item.id],
    )
  ).rows[0];
  expect(
    (
      await admin.request('PATCH', `/api/households/${world.houseId}/time-zone`, {
        json: { timeZone: 'Asia/Yekaterinburg' },
      })
    ).status,
  ).toBe(200);
  await refreshDeadlines(db, now, true);
  const old = (
    await world.database.admin.query(
      "SELECT id,starts_at,time_zone FROM deadline_occurrences WHERE deadline_id=$1 AND date='2025-01-10'",
      [item.id],
    )
  ).rows[0];
  expect(old).toEqual({
    id: initial.id,
    starts_at: new Date('2025-01-10T04:00:00Z'),
    time_zone: 'Asia/Yekaterinburg',
  });
});
