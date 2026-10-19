import { localDate, shiftTaskDate } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Device } from '../testing/device.ts';
import { createWorld, type World } from '../testing/world.ts';

type Card = { id: string; object: { id: string; title: string } | null };
type Feed = { days: { tasks: Card[] }[]; tasks: Card[] };
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
const today = () => localDate(new Date(), 'Asia/Yekaterinburg');
const place = (audience = 'household') => ({ spaceId: world.houseId, audience });
async function create(fields: Record<string, unknown>) {
  const response = await adult.post('/api/tasks', {
    title: 'Вымышленное дело D14',
    planOn: today(),
    placement: place(),
    ...fields,
  });
  expect(response.status, response.text).toBe(201);
  return response.json<{ id: string; updatedAt: string; nextTaskId: string }>();
}
it('TASK-5: ребёнок не получает название объекта Взрослых в plan, today и обоих офлайн-снимках', async () => {
  const response = await adult.post('/api/objects', {
    title: 'Вымышленный закрытый объект D14',
    placement: place('adults'),
  });
  expect(response.status, response.text).toBe(201);
  const object = response.json<{ id: string; title: string }>();
  const task = await create({ objectId: object.id });
  for (const feed of ['plan', 'today'])
    for (const offline of [false, true]) {
      const path = `/api/tasks/${feed}${offline ? '?offline=true' : ''}`;
      const result = await child.get(path);
      expect(result.status, result.text).toBe(200);
      const data = offline ? result.json<{ data: Feed }>().data : result.json<Feed>();
      const cards = feed === 'plan' ? data.days.flatMap((day) => day.tasks) : data.tasks;
      expect(cards.find((card: { id: string }) => card.id === task.id)).toMatchObject({
        id: task.id,
        object: null,
      });
      expect(result.text).not.toContain(object.title);
      const allowed = await adult.get(path);
      expect(allowed.status, allowed.text).toBe(200);
      expect(allowed.text).toContain(object.title);
    }
});
it('TASK-5: первый объект по созданию связи; без связи — null', async () => {
  const first = await adult.post('/api/objects', {
    title: 'Вымышленный первый объект',
    placement: place(),
  });
  const second = await adult.post('/api/objects', {
    title: 'Вымышленный второй объект',
    placement: place(),
  });
  const task = await create({ objectId: first.json().id });
  const link = await adult.post('/api/links', {
    left: { type: 'task', id: task.id },
    right: { type: 'object', id: second.json().id },
  });
  expect(link.status, link.text).toBe(201);
  const bare = await create({});
  const result = await child.get('/api/tasks/plan');
  expect(result.status, result.text).toBe(200);
  const cards = result.json<Feed>().days.flatMap((day) => day.tasks);
  expect(cards.find((card) => card.id === task.id)?.object).toEqual({
    id: first.json().id,
    title: first.json().title,
  });
  expect(cards.find((card) => card.id === bare.id)?.object).toBeNull();
});
it('TASK-5/D19a.8: первая скрытая связь не мешает следующему видимому объекту', async () => {
  const hidden = (
    await adult.post('/api/objects', { title: 'Закрытый объект D19', placement: place('adults') })
  ).json<{ id: string }>();
  const visible = (
    await adult.post('/api/objects', { title: 'Открытый объект D19', placement: place() })
  ).json<{ id: string; title: string }>();
  const task = await create({ objectId: hidden.id });
  expect(
    (
      await adult.post('/api/links', {
        left: { type: 'task', id: task.id },
        right: { type: 'object', id: visible.id },
      })
    ).status,
  ).toBe(201);
  for (const feed of ['plan', 'today']) {
    const response = await child.get(`/api/tasks/${feed}?offline=true`);
    expect(response.status, response.text).toBe(200);
    const data = response.json<{ data: Feed }>().data;
    const cards = feed === 'plan' ? data.days.flatMap((day) => day.tasks) : data.tasks;
    expect(cards.find((card) => card.id === task.id)?.object).toEqual({
      id: visible.id,
      title: visible.title,
    });
    expect(response.text).not.toContain(hidden.id);
  }
});
it('TASK-12: this меняет только экземпляр, following — шаблон; без права правки 403', async () => {
  const row = await create({ repeatRule: { kind: 'daily' }, planTime: '09:00' });
  for (const repeatScope of ['this', 'following']) {
    const date = shiftTaskDate(today(), repeatScope === 'this' ? 2 : 3);
    const result = await adult.request('PATCH', `/api/tasks/${row.id}`, {
      json: { planOn: date, repeatScope },
    });
    expect(result.status, result.text).toBe(200);
    expect(result.json()).toMatchObject({ planOn: date, planTime: '09:00' });
    const template = (
      await world.database.admin.query('SELECT repeat_template FROM tasks WHERE id=$1', [row.id])
    ).rows[0].repeat_template;
    expect(template.planOn).toBe(repeatScope === 'this' ? today() : date);
  }
  const forbidden = await child.request('PATCH', `/api/tasks/${row.id}`, {
    json: { planOn: shiftTaskDate(today(), 1) },
  });
  expect(forbidden.status, forbidden.text).toBe(403);
});
