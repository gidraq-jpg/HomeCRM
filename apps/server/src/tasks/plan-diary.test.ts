import { localDate, shiftTaskDate } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, child: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
afterAll(async () => {
  await world?.close();
});
it('TASK-5: история, часовой пояс, RLS, повтор и граница 365 дней', async () => {
  const today = localDate(new Date(), 'Asia/Yekaterinburg');
  const yesterday = shiftTaskDate(today, -1);
  const make = async (fields: object) => {
    const r = await adult.post('/api/tasks', { title: 'Вымышленное дело ежедневника', ...fields });
    expect(r.status, r.text).toBe(201);
    return r.json<{ id: string }>();
  };
  const common = {
    placement: { spaceId: world.houseId, audience: 'household' },
    planOn: yesterday,
  };
  const late = await make(common);
  const before = await make(common),
    after = await make(common);
  const privateTask = await make({ planOn: yesterday });
  const adults = await make({
    ...common,
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  const repeat = await make({ ...common, repeatRule: { kind: 'daily' } });
  for (const task of [before, after, privateTask, adults, repeat]) {
    const r = await adult.post(`/api/tasks/${task.id}/status`, { status: 'done' });
    expect(r.status, r.text).toBe(200);
  }
  await world.database.admin.query(
    'UPDATE tasks SET done_at=$1::timestamptz WHERE id=ANY($2::uuid[])',
    [`${yesterday}T23:30:00+05:00`, [before.id, privateTask.id, adults.id, repeat.id]],
  );
  await world.database.admin.query('UPDATE tasks SET done_at=$1::timestamptz WHERE id=$2', [
    `${today}T00:30:00+05:00`,
    after.id,
  ]);
  const url = `/api/tasks/plan?householdId=${world.houseId}&cursor=${yesterday}`;
  const r = await adult.get(url);
  expect(r.status, r.text).toBe(200);
  const feed = r.json<{ days: { date: string; tasks: { id: string }[] }[]; prevCursor: string }>();
  const ids = (date: string) => feed.days.find((d) => d.date === date)?.tasks.map((t) => t.id);
  expect(ids(yesterday)).toEqual(expect.arrayContaining([late.id, before.id, repeat.id]));
  expect(ids(yesterday)).not.toContain(after.id);
  expect(ids(today)).toContain(after.id);
  const kid = (await child.get(url)).json<typeof feed>();
  expect(kid.days.flatMap((d) => d.tasks).map((t) => t.id)).not.toEqual(
    expect.arrayContaining([privateTask.id]),
  );
  expect(kid.days.flatMap((d) => d.tasks).map((t) => t.id)).not.toContain(adults.id);
  const boundary = await adult.get(`/api/tasks/plan?cursor=${shiftTaskDate(today, -365)}`);
  expect(boundary.status).toBe(200);
  expect(boundary.json().prevCursor).toBeNull();
  expect((await adult.get(`/api/tasks/plan?cursor=${shiftTaskDate(today, -366)}`)).status).toBe(
    400,
  );
  const nextId = (
    await world.database.admin.query('SELECT id FROM tasks WHERE predecessor_id=$1', [repeat.id])
  ).rows[0]?.id;
  expect(nextId).toBeTruthy();
  if (nextId)
    expect(feed.days.flatMap((d) => d.tasks).filter((t) => t.id === nextId)).toHaveLength(1);
});
