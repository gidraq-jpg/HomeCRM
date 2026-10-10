import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device;
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
});
afterAll(async () => {
  await world?.close();
});
it('TASK-7: отмена повторного выполнения сохраняет преемника прежнего выполнения', async () => {
  const created = await adult.post('/api/tasks', {
    title: 'Вымышленная серия для проверки отмены',
    planOn: '2026-10-10',
    repeatRule: { kind: 'daily' },
  });
  expect(created.status, created.text).toBe(201);
  const id = created.json<{ id: string }>().id;
  const completed = await adult.post(`/api/tasks/${id}/status`, { status: 'done' });
  expect(completed.status, completed.text).toBe(200);
  const nextId = completed.json<{ nextTaskId: string }>().nextTaskId;
  expect(nextId).toBeTruthy();
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [id],
  );
  const resumed = await adult.post(`/api/tasks/${id}/status`, { status: 'open' });
  expect(resumed.status, resumed.text).toBe(200);
  expect(resumed.json().nextTaskId).toBe(nextId);
  const recompleted = await adult.post(`/api/tasks/${id}/status`, { status: 'done' });
  expect(recompleted.status, recompleted.text).toBe(200);
  expect(recompleted.json().nextTaskId).toBe(nextId);
  const undone = await adult.post(`/api/tasks/${id}/undo`, {
    eventId: recompleted.json().completionEventId,
  });
  expect(undone.status, undone.text).toBe(200);
  const next = await adult.get(`/api/tasks/${nextId}`);
  expect(next.status, next.text).toBe(200);
  expect(next.json().deletedAt).toBeNull();
  expect(undone.json().nextTaskId).toBe(nextId);
});
