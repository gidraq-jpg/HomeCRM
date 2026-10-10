import { localDate } from '@homecrm/shared';
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
});
afterAll(async () => {
  await world?.close();
});
type Task = { id: string; seriesId: string; completionEventId: string; nextTaskId: string | null };
for (const path of ['undo', 'status', 'patch'] as const)
  for (const edited of [false, true])
    it(`TASK-7: ${path} отменяет повторное выполнение, сохраняя ${edited ? 'изменённого' : 'прежнего'} преемника и историю`, async () => {
      const zone =
        (
          await world.database.admin.query('SELECT time_zone FROM spaces WHERE id=$1', [
            world.houseId,
          ])
        ).rows[0]?.time_zone ?? 'UTC';
      const created = await adult.post('/api/tasks', {
        title: 'Преемник первого события',
        planOn: localDate(new Date(), zone),
        repeatRule: { kind: 'daily' },
      });
      expect(created.status, created.text).toBe(201);
      const row = created.json<Task>();
      const completed = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
      expect(completed.status, completed.text).toBe(200);
      const first = completed.json<Task>();
      if (edited)
        expect(
          (
            await adult.request('PATCH', `/api/tasks/${first.nextTaskId}`, {
              json: { title: 'Прежний преемник с правкой' },
            })
          ).status,
        ).toBe(200);
      await world.database.admin.query(
        "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
        [row.id],
      );
      expect(
        (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: first.completionEventId }))
          .status,
      ).toBe(409);
      expect((await adult.post(`/api/tasks/${row.id}/status`, { status: 'open' })).status).toBe(
        200,
      );
      const responses = await Promise.all([
        adult.post(`/api/tasks/${row.id}/status`, { status: 'done' }),
        adult.post(`/api/tasks/${row.id}/status`, { status: 'done' }),
      ]);
      for (const response of responses) expect(response.status, response.text).toBe(200);
      const second = responses[0]?.json<Task>();
      if (!second) throw new Error('Missing second completion');
      expect(second.completionEventId).not.toBe(first.completionEventId);
      expect(responses[1]?.json<Task>().completionEventId).toBe(second.completionEventId);
      expect(second.nextTaskId).toBe(first.nextTaskId);
      const nextBefore = (
        await world.database.admin.query('SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1', [
          first.nextTaskId,
        ])
      ).rows[0]?.data;
      const response =
        path === 'patch'
          ? await adult.request('PATCH', `/api/tasks/${row.id}`, { json: { status: 'open' } })
          : await adult.post(
              `/api/tasks/${row.id}/${path}`,
              path === 'undo' ? { eventId: second.completionEventId } : { status: 'open' },
            );
      expect(response.status, response.text).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'open',
        doneAt: null,
        nextTaskId: first.nextTaskId,
        completionEventId: second.completionEventId,
      });
      expect(response.json().completionUndoneAt).not.toBeNull();
      expect(
        (
          await world.database.admin.query('SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1', [
            first.nextTaskId,
          ])
        ).rows[0]?.data,
      ).toEqual(nextBefore);
      expect(
        (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: second.completionEventId }))
          .status,
      ).toBe(200);
      expect(
        (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: first.completionEventId }))
          .status,
      ).toBe(409);
      expect(
        (await child.post(`/api/tasks/${row.id}/undo`, { eventId: second.completionEventId }))
          .status,
      ).toBe(404);
      expect((await child.get(`/api/tasks/${first.nextTaskId}`)).status).toBe(404);
      const history = (await adult.get(`/api/tasks/${row.id}/history`)).json<
        {
          changes: {
            completion_event_id?: { new: string };
            completion_undone_at?: { new: string | null };
            task_resumed?: { new: boolean };
          };
        }[]
      >();
      expect(history.filter((h) => h.changes.completion_event_id?.new)).toHaveLength(2);
      expect(history.some((h) => h.changes.task_resumed?.new)).toBe(true);
      expect(history.some((h) => h.changes.completion_undone_at?.new)).toBe(true);
      const plan = (await adult.get('/api/tasks/plan')).json<{ days: { tasks: Task[] }[] }>();
      expect(
        plan.days
          .flatMap((d) => d.tasks)
          .filter((t) => t.seriesId === row.seriesId)
          .map((t) => t.id),
      ).toEqual([first.nextTaskId]);
      expect(
        (
          await adult.request('PATCH', `/api/tasks/${row.id}`, {
            json: { repeatScope: 'following', title: 'Прежний экземпляр' },
          })
        ).status,
      ).toBe(409);
      const again = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
      expect(again.status, again.text).toBe(200);
      expect(again.json<Task>().nextTaskId).toBe(first.nextTaskId);
      expect(
        (
          await world.database.admin.query(
            'SELECT id FROM tasks WHERE series_id=$1 AND deleted_at IS NULL',
            [row.seriesId],
          )
        ).rows,
      ).toHaveLength(2);
    });
