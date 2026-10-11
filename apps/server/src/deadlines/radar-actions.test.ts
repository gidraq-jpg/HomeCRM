import { randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { CalendarDate, localDate, shiftTaskDate } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';
import { initializeHouseTimeZones, refreshDeadlines } from './engine.ts';

let world: World, adult: Device, admin: Device, child: Device;
const radarUrl = '/api/deadlines?from=0001-01-01&to=9999-12-31';
type Item = {
  id: string;
  deadlineId: string;
  calendarKey: string;
  title: string;
  canWrite: boolean;
  actionState: { version: number; status: string; reason: string | null };
  assigneeId: string;
};
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await initializeHouseTimeZones(createWorkerDatabase(world.database.worker), 'Asia/Yekaterinburg');
});
afterAll(async () => world?.close());
async function source(common = false) {
  const parent = await adult.post('/api/notes', {
    title: `Вымышленный срок ${randomUUID()}`,
    ...(common ? { placement: { spaceId: world.houseId, audience: 'household' } } : {}),
  });
  expect(parent.status, parent.text).toBe(201);
  const noteId = parent.json<{ id: string }>().id;
  const deadline = await adult.post(`/api/notes/${noteId}/deadlines`, {
    rule: {
      kind: 'repeat',
      anchor: shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), -1),
      repeat: { unit: 'month', day: 11 },
      warnings: [],
    },
  });
  expect(deadline.status, deadline.text).toBe(201);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const id = deadline.json<{ id: string }>().id;
  const item = (await adult.get(radarUrl))
    .json<{ items: Item[] }>()
    .items.find((x) => x.deadlineId === id);
  expect(item).toBeDefined();
  return { noteId, deadlineId: id, item: item as Item };
}
function body(item: Item, action = 'dismiss') {
  return {
    action,
    calendarKey: item.calendarKey,
    expectedVersion: item.actionState.version,
    idempotencyKey: randomUUID(),
    reason: 'Вымышленная причина',
  };
}
it('неактуальность общая; причина под RLS; повтор, гонка и устаревшая версия', async () => {
  const s = await source(true),
    input = body(s.item);
  expect((await child.post(`/api/deadlines/occurrences/${s.item.id}/action`, input)).status).toBe(
    403,
  );
  const [first, second] = await Promise.all([
    admin.post(`/api/deadlines/occurrences/${s.item.id}/action`, input),
    admin.post(`/api/deadlines/occurrences/${s.item.id}/action`, input),
  ]);
  expect([first.status, second.status]).toEqual([200, 200]);
  expect(first.json()).toEqual(second.json());
  expect(
    (await adult.get(radarUrl)).json<{ items: Item[] }>().items.some((x) => x.id === s.item.id),
  ).toBe(false);
  const hidden = (await child.get(`${radarUrl}&state=dismissed`))
    .json<{ items: Item[] }>()
    .items.find((x) => x.id === s.item.id);
  expect(hidden?.actionState.reason).toBe(input.reason);
  expect(hidden?.canWrite).toBe(false);
  expect(
    (
      await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, {
        ...body(s.item),
        action: 'restore',
      })
    ).status,
  ).toBe(409);
  const restore = await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, {
    ...body(s.item),
    action: 'restore',
    expectedVersion: 1,
  });
  expect(restore.status, restore.text).toBe(200);
  expect(
    (await adult.get(radarUrl)).json<{ items: Item[] }>().items.some((x) => x.id === s.item.id),
  ).toBe(true);
  expect(
    (
      await world.database.admin.query('SELECT has_other_contributions FROM notes WHERE id=$1', [
        s.noteId,
      ])
    ).rows[0].has_other_contributions,
  ).toBe(true);
});
it('состояние переживает пересчёт, смену пояса и корзину, другой экземпляр не затронут', async () => {
  const s = await source();
  const input = {
    ...body(s.item, 'snooze'),
    date: shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), 3),
    time: '08:00',
  };
  const saved = await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, input);
  expect(saved.status, saved.text).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const snoozed = (await adult.get(`${radarUrl}&state=snoozed`))
    .json<{ items: Item[] }>()
    .items.find((x) => x.id === s.item.id);
  expect(snoozed?.actionState.status).toBe('snoozed');
  const moment = (
    await world.database.admin.query(
      'SELECT snoozed_until FROM radar_actions WHERE deadline_id=$1',
      [s.deadlineId],
    )
  ).rows[0].snoozed_until;
  try {
    await world.database.admin.query("UPDATE spaces SET time_zone='Europe/Berlin' WHERE id=$1", [
      world.houseId,
    ]);
    await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
    const changed = (await adult.get(`${radarUrl}&state=snoozed`))
      .json<{ items: Item[] }>()
      .items.find((x) => x.deadlineId === s.deadlineId);
    expect(changed?.actionState.status).toBe('snoozed');
    expect(
      (
        await world.database.admin.query(
          'SELECT snoozed_until FROM radar_actions WHERE deadline_id=$1',
          [s.deadlineId],
        )
      ).rows[0].snoozed_until,
    ).toEqual(moment);
  } finally {
    await world.database.admin.query(
      "UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1",
      [world.houseId],
    );
    await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  }
  expect((await admin.get(`${radarUrl}&state=all`)).text).not.toContain(s.item.deadlineId);
  const trash = await adult.post(`/api/notes/${s.noteId}/trash`, {});
  expect(trash.status, trash.text).toBe(200);
  expect((await adult.get(`${radarUrl}&state=all`)).text).not.toContain(s.item.id);
  expect((await adult.post(`/api/notes/${s.noteId}/restore`, {})).status).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const restored = (await adult.get(`${radarUrl}&state=all`))
    .json<{ items: Item[] }>()
    .items.filter((x) => x.deadlineId === s.deadlineId);
  expect(restored.find((x) => x.id === s.item.id)?.actionState.status).toBe('snoozed');
  expect(restored.filter((x) => x.id !== s.item.id).every((x) => x.actionState.version === 0)).toBe(
    true,
  );
  const change = await adult.request('PATCH', `/api/deadlines/${s.deadlineId}`, {
    json: {
      rule: {
        kind: 'date',
        date: CalendarDate.parse(shiftTaskDate(localDate(new Date(), 'Asia/Yekaterinburg'), 2)),
      },
    },
  });
  expect(change.status, change.text).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const next = (await adult.get(`${radarUrl}&state=all`))
    .json<{ items: Item[] }>()
    .items.find((x) => x.deadlineId === s.deadlineId);
  expect(next?.actionState.version).toBe(0);
  expect(
    (
      await world.database.admin.query('SELECT id FROM radar_actions WHERE deadline_id=$1', [
        s.deadlineId,
      ])
    ).rowCount,
  ).toBe(1);
});
it('пустая причина и скрытые ID фильтров/мутаций отклоняются', async () => {
  const s = await source();
  expect(
    (
      await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, {
        ...body(s.item),
        reason: '  ',
      })
    ).status,
  ).toBe(400);
  expect(
    (await admin.post(`/api/deadlines/occurrences/${s.item.id}/action`, body(s.item))).status,
  ).toBe(404);
  expect((await adult.get(`${radarUrl}&objectId=${randomUUID()}`)).status).toBe(404);
  expect((await adult.get(`${radarUrl}&personId=${randomUUID()}`)).status).toBe(404);
});
it('обычный срок закрывается явно, правило after получает дату подтверждённого события; повтор не создаёт второй результат', async () => {
  const s = await source();
  const input = body(s.item, 'complete');
  const first = await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, input);
  expect(first.status, first.text).toBe(200);
  expect(
    (await adult.post(`/api/deadlines/occurrences/${s.item.id}/action`, input)).json(),
  ).toEqual(first.json());
  expect(
    (await adult.get(radarUrl)).json<{ items: Item[] }>().items.some((x) => x.id === s.item.id),
  ).toBe(false);
  const date = localDate(new Date(), 'Asia/Yekaterinburg');
  const rule = { kind: 'after', every: 7, unit: 'day', eventDate: null };
  const note = (await adult.post('/api/notes', { title: 'Вымышленное событие after' })).json<{
    id: string;
  }>();
  const created = await adult.post(`/api/notes/${note.id}/deadlines`, { rule });
  expect(created.status, created.text).toBe(201);
  const deadline = created.json<{ id: string }>();
  const changed = await adult.request('PATCH', `/api/deadlines/${deadline.id}`, {
    json: { rule: { ...rule, eventDate: date } },
  });
  expect(changed.status, changed.text).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const occurrence = (await adult.get(radarUrl))
    .json<{ items: Item[] }>()
    .items.find((x) => x.deadlineId === deadline.id);
  expect(occurrence).toBeDefined();
  if (!occurrence) throw new Error('Missing after occurrence');
  const completion = body(occurrence, 'complete');
  expect(
    (await adult.post(`/api/deadlines/occurrences/${occurrence.id}/action`, completion)).status,
  ).toBe(200);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  expect(
    (await world.database.admin.query('SELECT rule FROM deadlines WHERE id=$1', [deadline.id]))
      .rows[0].rule.eventDate,
  ).toBe(date);
  expect(
    (
      await world.database.admin.query('SELECT id FROM radar_actions WHERE deadline_id=$1', [
        deadline.id,
      ])
    ).rowCount,
  ).toBe(1);
});
it('ребёнок меняет отметку назначенного ему дела, но не другого общего срока', async () => {
  const task = await adult.post('/api/tasks', {
    title: 'Вымышленное дело ребёнка',
    dueOn: localDate(new Date(), 'Asia/Yekaterinburg'),
    assigneeId: world.vera.id,
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(task.status, task.text).toBe(201);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const taskId = task.json<{ id: string }>().id;
  const item = (await child.get(radarUrl))
    .json<{ items: (Item & { taskId: string })[] }>()
    .items.find((x) => x.taskId === taskId);
  expect(item?.canWrite).toBe(true);
  if (!item) throw new Error('Missing task occurrence');
  const result = await child.post(`/api/deadlines/occurrences/${item.id}/action`, body(item));
  expect(result.status, result.text).toBe(200);
});
it('фильтры совместно используют видимую связь объекта и роль адресата ожидания; скрытый ID не раскрывает справочник', async () => {
  const object = await adult.post('/api/objects', {
    title: 'Вымышленный видимый объект',
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  const hidden = await adult.post('/api/objects', {
    title: 'Вымышленный скрытый объект',
    placement: { spaceId: world.houseId, audience: 'adults' },
  });
  expect(object.status, object.text).toBe(201);
  expect(hidden.status, hidden.text).toBe(201);
  const objectId = object.json<{ id: string }>().id,
    hiddenId = hidden.json<{ id: string }>().id;
  const task = await adult.post('/api/tasks', {
    title: 'Вымышленное ожидание с объектом',
    status: 'waiting',
    checkOn: localDate(new Date(), 'Asia/Yekaterinburg'),
    waitingAccountId: world.anna.id,
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(task.status, task.text).toBe(201);
  const taskId = task.json<{ id: string }>().id;
  for (const id of [objectId, hiddenId])
    expect(
      (
        await adult.post('/api/links', {
          left: { type: 'task', id: taskId },
          right: { type: 'object', id },
          role: 'Объект дела',
        })
      ).status,
    ).toBe(201);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const query = `${radarUrl}&householdId=${world.houseId}&objectId=${objectId}&personId=${world.anna.id}&scope=household&view=mine`;
  const filtered = await adult.get(query);
  expect(filtered.status, filtered.text).toBe(200);
  const result = filtered.json<{ items: { taskId: string }[]; groups: Record<string, number> }>();
  expect(result.items.length).toBeGreaterThan(0);
  expect(result.items.every((x) => x.taskId === taskId)).toBe(true);
  expect(Object.values(result.groups).reduce((a, b) => a + b, 0)).toBe(result.items.length);
  const visible = await child.get(radarUrl);
  expect(visible.status, visible.text).toBe(200);
  expect(visible.text).not.toContain(hiddenId);
  expect(visible.text).not.toContain('Вымышленный скрытый объект');
  expect((await child.get(`${radarUrl}&objectId=${hiddenId}`)).status).toBe(404);
});
it('два дома около полуночи: группа и UTC откладывания берутся из пояса каждого источника', async () => {
  const instance = await createWorld();
  try {
    const device = instance.device();
    await device.signIn(instance.boris.username, instance.boris.password);
    const second = (
      await instance.database.admin.query(
        "INSERT INTO spaces(kind,name,time_zone) VALUES('household','Вымышленный второй дом','Asia/Tokyo') RETURNING id",
      )
    ).rows[0].id as string;
    await instance.database.admin.query(
      "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult'),($1,$3,'admin')",
      [second, instance.boris.id, instance.anna.id],
    );
    await instance.database.admin.query(
      "UPDATE spaces SET time_zone='America/Los_Angeles' WHERE id=$1",
      [instance.houseId],
    );
    for (const house of [instance.houseId, second]) {
      const note = await device.post('/api/notes', {
        title: 'Вымышленное обязательство двух домов',
        placement: { spaceId: house, audience: 'household' },
      });
      expect(note.status, note.text).toBe(201);
      const d = await device.post(`/api/notes/${note.json<{ id: string }>().id}/deadlines`, {
        rule: { kind: 'date', date: '2026-10-11', warnings: [] },
      });
      expect(d.status, d.text).toBe(201);
    }
    const clock = new Date('2026-10-11T00:30:00Z');
    await refreshDeadlines(createWorkerDatabase(instance.database.worker), clock, true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
    const response = await device.get(radarUrl);
    expect(response.status, response.text).toBe(200);
    const items = response.json<{
      items: (Item & { householdId: string; group: string; timeZone: string })[];
      options: { houses: unknown[] };
    }>();
    expect(items.options.houses).toHaveLength(2);
    expect(items.items.find((x) => x.householdId === second)?.group).toBe('now');
    expect(items.items.find((x) => x.householdId === instance.houseId)?.group).toBe('7days');
    for (const x of items.items) {
      const saved = await device.post(`/api/deadlines/occurrences/${x.id}/action`, {
        action: 'snooze',
        date: '2099-10-12',
        time: '10:30',
        expectedVersion: 0,
        calendarKey: x.calendarKey,
        idempotencyKey: randomUUID(),
      });
      expect(saved.status, saved.text).toBe(200);
      expect(saved.json<{ snoozedUntil: string }>().snoozedUntil).toBe(
        x.householdId === second ? '2099-10-12T01:30:00.000Z' : '2099-10-12T17:30:00.000Z',
      );
    }
  } finally {
    vi.useRealTimers();
    await instance.close();
  }
});
it('DST: несуществующее местное время откладывания отклоняется без записи отметки', async () => {
  const s = await source();
  try {
    expect(
      (
        await admin.request('PATCH', `/api/households/${world.houseId}/time-zone`, {
          json: { timeZone: 'Europe/Berlin' },
        })
      ).status,
    ).toBe(200);
    await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
    const item = (await adult.get(radarUrl))
      .json<{ items: Item[] }>()
      .items.find((x) => x.deadlineId === s.deadlineId);
    if (!item) throw new Error('Missing DST occurrence');
    const year = new Date().getUTCFullYear() + 1,
      last = new Date(Date.UTC(year, 3, 0));
    last.setUTCDate(last.getUTCDate() - last.getUTCDay());
    const date = last.toISOString().slice(0, 10);
    const response = await adult.post(`/api/deadlines/occurrences/${item.id}/action`, {
      action: 'snooze',
      calendarKey: item.calendarKey,
      expectedVersion: 0,
      idempotencyKey: randomUUID(),
      date,
      time: '02:30',
    });
    expect(response.status, response.text).toBe(400);
    expect(response.json()).toEqual({ code: 'INVALID_LOCAL_TIME' });
    expect(
      (
        await world.database.admin.query('SELECT id FROM radar_actions WHERE deadline_id=$1', [
          s.deadlineId,
        ])
      ).rowCount,
    ).toBe(0);
  } finally {
    await world.database.admin.query(
      "UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1",
      [world.houseId],
    );
  }
});
