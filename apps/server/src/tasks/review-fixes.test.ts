import { randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { localDate } from '@homecrm/shared';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createHousehold } from '../auth/provision.ts';
import { refreshDeadlines } from '../deadlines/engine.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device, child: Device, second: string;
type Task = {
  id: string;
  updatedAt: string;
  completionEventId: string;
  nextTaskId: string | null;
  hasOtherContributions: boolean;
};
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  second = await createHousehold(world.fixtures, 'Второй тестовый дом');
  await world.database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
    [second, world.boris.id],
  );
  await world.database.admin.query(
    "UPDATE spaces SET time_zone=CASE WHEN id=$1 THEN 'Pacific/Kiritimati' ELSE 'America/Los_Angeles' END WHERE id=ANY($2::uuid[])",
    [second, [second, world.houseId]],
  );
});
afterEach(() => vi.useRealTimers());
afterAll(async () => {
  await world?.close();
});
async function create(body: Record<string, unknown> = {}) {
  const response = await adult.post('/api/tasks', { title: 'Тестовое дело', ...body });
  expect(response.status, response.text).toBe(201);
  return response.json<Task>();
}
const patch = (id: string, body: Record<string, unknown>, device = adult) =>
  device.request('PATCH', `/api/tasks/${id}`, { json: body });

for (const field of ['planOn', 'dueOn', 'checkOn'])
  it(`A1: старое личное дело — ${field}, явный дом, атомарность, версия и повтор`, async () => {
    const row = await create();
    await world.database.admin.query('UPDATE tasks SET household_id=NULL WHERE id=$1', [row.id]);
    const base = (await adult.get(`/api/tasks/${row.id}`)).json<Task>();
    const dates = {
      [field]: '2030-01-02',
      ...(field === 'checkOn' ? { status: 'waiting', waitingAccountId: world.anna.id } : {}),
    };
    expect((await patch(row.id, dates)).json()).toEqual({ code: 'HOUSE_REQUIRED' });
    expect((await adult.get(`/api/tasks/${row.id}`)).json()).toMatchObject({
      status: 'open',
      [field]: null,
      householdId: null,
    });
    const body = {
      ...dates,
      householdId: second,
      expectedUpdatedAt: base.updatedAt,
      idempotencyKey: randomUUID(),
    };
    const first = await patch(row.id, body);
    expect(first.status, first.text).toBe(200);
    expect(first.json()).toMatchObject({ householdId: second, [field]: '2030-01-02' });
    expect((await patch(row.id, body)).json()).toEqual(first.json());
    expect(
      (
        await patch(row.id, { description: 'Старый черновик', expectedUpdatedAt: base.updatedAt })
      ).json(),
    ).toEqual({ code: 'STALE_VERSION' });
    expect((await patch(row.id, { householdId: world.houseId })).json()).toEqual({
      code: 'HOUSE_ALREADY_BOUND',
    });
    const deadline = (
      await world.database.admin.query(
        'SELECT household_id FROM deadlines WHERE task_id=$1 AND deleted_at IS NULL',
        [row.id],
      )
    ).rows;
    expect(deadline).toHaveLength(1);
    expect(deadline[0]?.household_id).toBe(second);
  });
it('A1: чужой дом скрыт; общее и привязанная серия не меняют дом', async () => {
  const foreign = await createHousehold(world.fixtures, 'Чужой дом');
  const personal = await create();
  await world.database.admin.query('UPDATE tasks SET household_id=NULL WHERE id=$1', [personal.id]);
  expect((await patch(personal.id, { householdId: foreign, planOn: '2030-01-02' })).status).toBe(
    404,
  );
  for (const body of [
    { placement: { spaceId: world.houseId, audience: 'household' } },
    { planOn: '2030-01-02', repeatRule: { kind: 'daily' } },
  ]) {
    const row = await create(body);
    expect((await patch(row.id, { householdId: second })).json()).toEqual({
      code: 'HOUSE_ALREADY_BOUND',
    });
  }
});
it('A2: видимый срок дела даёт EDIT_SOURCE, личный другого и удалённый — 404', async () => {
  const row = await create({ planOn: '2030-01-02' });
  const id = (
    await world.database.admin.query('SELECT id FROM deadlines WHERE task_id=$1', [row.id])
  ).rows[0]?.id;
  expect(
    (await adult.post(`/api/deadlines/${id}/assignee`, { assigneeId: world.boris.id })).json(),
  ).toEqual({ code: 'EDIT_SOURCE' });
  expect(
    (await admin.post(`/api/deadlines/${id}/assignee`, { assigneeId: world.anna.id })).status,
  ).toBe(404);
  await adult.post(`/api/tasks/${row.id}/trash`, {});
  expect(
    (await adult.post(`/api/deadlines/${id}/assignee`, { assigneeId: world.boris.id })).status,
  ).toBe(404);
});
it('A2: ребёнок читает ручной срок, но не назначает; взрослый меняет под блокировкой', async () => {
  const object = (
    await adult.post('/api/objects', {
      title: 'Общий источник',
      placement: { spaceId: world.houseId, audience: 'household' },
    })
  ).json<{ id: string }>();
  const deadline = await adult.post(`/api/objects/${object.id}/deadlines`, {
    rule: { kind: 'date', date: '2030-01-02' },
  });
  expect(deadline.status).toBe(201);
  const id = deadline.json().id;
  expect(
    (await child.post(`/api/deadlines/${id}/assignee`, { assigneeId: world.vera.id })).status,
  ).toBe(403);
  expect(
    (await adult.post(`/api/deadlines/${id}/assignee`, { assigneeId: world.anna.id })).status,
  ).toBe(200);
});
it('A3: точные коды, успешный повтор и атомарный отказ после окна', async () => {
  const row = await create({ planOn: '2030-01-02', repeatRule: { kind: 'daily' } });
  const done = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  expect((await adult.post(`/api/tasks/${row.id}/undo`, { eventId: randomUUID() })).json()).toEqual(
    { code: 'COMPLETION_CHANGED' },
  );
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '6 seconds' WHERE id=$1",
    [row.id],
  );
  const undo = await adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId });
  expect(undo.status, undo.text).toBe(200);
  expect(
    (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId })).status,
  ).toBe(200);
  const again = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [row.id],
  );
  expect(
    (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: again.completionEventId })).json(),
  ).toEqual({ code: 'UNDO_EXPIRED' });
  expect((await adult.get(`/api/tasks/${row.id}`)).json()).toMatchObject({
    status: 'done',
    nextTaskId: again.nextTaskId,
  });
});
it('A3: изменённый преемник блокирует undo/PATCH/status; прежний преемник не принадлежит повторному выполнению', async () => {
  const row = await create({ planOn: '2030-01-02', repeatRule: { kind: 'daily' } });
  const done = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  expect((await patch(done.nextTaskId ?? '', { description: 'Правка преемника' })).status).toBe(
    200,
  );
  for (const path of ['undo', 'patch', 'status']) {
    const r =
      path === 'patch'
        ? await patch(row.id, { status: 'open' })
        : await adult.post(
            `/api/tasks/${row.id}/${path}`,
            path === 'undo' ? { eventId: done.completionEventId } : { status: 'open' },
          );
    expect(r.status, r.text).toBe(409);
    expect(r.json()).toEqual({ code: 'NEXT_TASK_CHANGED' });
  }
  for (const path of ['patch', 'status']) {
    const body = { status: 'waiting', waitingAccountId: world.anna.id, checkOn: '2030-01-02' };
    const response =
      path === 'patch'
        ? await patch(row.id, body)
        : await adult.post(`/api/tasks/${row.id}/status`, body);
    expect(response.status, response.text).toBe(409);
    expect(response.json()).toEqual({ code: 'NEXT_TASK_CHANGED' });
  }
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [row.id],
  );
  expect((await patch(row.id, { status: 'open' })).status).toBe(200);
  const again = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  const undo = await adult.post(`/api/tasks/${row.id}/undo`, { eventId: again.completionEventId });
  expect(undo.status, undo.text).toBe(200);
  expect(undo.json()).toMatchObject({ status: 'open', nextTaskId: done.nextTaskId });
});
it('A4: автор без вклада переносит в личное, чужой чек-лист после чтения блокирует прямой запрос', async () => {
  const placement = { spaceId: world.houseId, audience: 'household' };
  const row = await create({
    placement,
    checklist: [{ id: randomUUID(), title: 'Пункт', done: false, position: 0 }],
  });
  expect(row.hasOtherContributions).toBe(false);
  const changed = await admin.request('PATCH', `/api/tasks/${row.id}`, {
    json: {
      checklist: [
        {
          ...(await adult.get(`/api/tasks/${row.id}`)).json<{
            checklist: Record<string, unknown>[];
          }>().checklist[0],
          done: true,
        },
      ],
    },
  });
  expect(changed.status, changed.text).toBe(200);
  expect((await adult.get(`/api/tasks/${row.id}`)).json()).toMatchObject({
    hasOtherContributions: true,
  });
  expect(
    (
      await adult.post(`/api/tasks/${row.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(403);
  const own = await create({ placement, planOn: '2030-01-02', repeatRule: { kind: 'daily' } });
  for (const action of ['trash', 'restore'])
    expect((await admin.post(`/api/tasks/${own.id}/${action}`, {})).status).toBe(200);
  expect(
    (
      await admin.post(`/api/tasks/${own.id}/move`, {
        ...placement,
        audience: 'adults',
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await adult.get(`/api/tasks/${own.id}`)).json()).toMatchObject({
    hasOtherContributions: false,
  });
  expect(
    (
      await adult.post(`/api/tasks/${own.id}/move`, {
        spaceId: world.boris.personalSpaceId,
        confirmed: true,
      })
    ).status,
  ).toBe(200);
  expect((await admin.get(`/api/tasks/${own.id}`)).status).toBe(404);
});
it('A5: два пояса около полуночи, today/plan, чужой дом и вышедший участник', async () => {
  const now = new Date(`${new Date().toISOString().slice(0, 10)}T10:30:00Z`);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const seeded: { house: string; id: string; zone: string }[] = [];
  for (const [house, zone] of [
    [world.houseId, 'America/Los_Angeles'],
    [second, 'Pacific/Kiritimati'],
  ] as const) {
    const row = await create({
      householdId: house,
      planOn: localDate(now, zone),
      planTime: '00:00',
    });
    seeded.push({ house, zone, id: row.id });
  }
  await refreshDeadlines(createWorkerDatabase(world.database.worker), now, true);
  for (const [house, timeZone] of [
    [world.houseId, 'America/Los_Angeles'],
    [second, 'Pacific/Kiritimati'],
  ]) {
    for (const view of ['today', 'plan']) {
      const response = await adult.get(`/api/tasks/${view}?householdId=${house}`);
      expect(response.status, response.text).toBe(200);
      expect(response.json()).toMatchObject({
        householdId: house,
        timeZone,
        today: localDate(now, timeZone ?? 'UTC'),
      });
      if (view === 'today') {
        const feed = response.json<{
          tasks: { id: string }[];
          radar: { taskId: string; householdId: string; timeZone: string }[];
        }>();
        expect(feed.tasks.map((task) => task.id)).toContain(
          seeded.find((task) => task.house === house)?.id,
        );
        expect(feed.tasks.map((task) => task.id)).not.toContain(
          seeded.find((task) => task.house !== house)?.id,
        );
        expect(feed.radar).toContainEqual(
          expect.objectContaining({
            taskId: seeded.find((task) => task.house === house)?.id,
            householdId: house,
            timeZone,
          }),
        );
        expect(feed.radar.every((item) => item.householdId === house)).toBe(true);
      }
    }
  }
  expect((await child.get(`/api/tasks/today?householdId=${second}`)).status).toBe(404);
  await world.database.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
    [second, world.boris.id],
  );
  expect((await adult.get(`/api/tasks/plan?householdId=${second}`)).status).toBe(404);
});
