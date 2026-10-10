import { randomBytes, randomUUID } from 'node:crypto';
import { createWorkerDatabase } from '@homecrm/db';
import { localDate, shiftTaskDate } from '@homecrm/shared';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { enqueueDeadlineWarnings, refreshDeadlines } from '../deadlines/engine.ts';
import { redactUrl } from '../logging.ts';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import type { Device } from '../testing/device.ts';
import { signedInAdmin } from '../testing/flows.ts';
import { createWorld, type World } from '../testing/world.ts';

let world: World, adult: Device, admin: Device, child: Device;
type Task = {
  id: string;
  seriesId: string | null;
  planOn: string | null;
  status: string;
  nextTaskId: string | null;
  completionEventId: string;
  completionUndoneAt: string | null;
};
beforeAll(async () => {
  world = await createWorld();
  adult = world.device();
  child = world.device();
  await adult.signIn(world.boris.username, world.boris.password);
  await child.signIn(world.vera.username, world.vera.password);
  admin = (await signedInAdmin(world)).device;
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
afterAll(async () => {
  await world?.close();
});
async function create(fields: Record<string, unknown> = {}) {
  const r = await adult.post('/api/tasks', {
    title: 'Вымышленная серия',
    planOn: '2026-01-31',
    repeatRule: { kind: 'monthly', day: 31 },
    ...fields,
  });
  expect(r.status, r.text).toBe(201);
  return r.json<Task>();
}
it('TASK-11: закрытый триггер назначения принимает вымышленную запись', async () => {
  await world.database.admin.query(
    "INSERT INTO tasks(space_id,space_kind,audience,author_id,assignee_id,title,household_id) VALUES($1,'household','household',$2,$3,'Тест назначения',$1)",
    [world.houseId, world.boris.id, world.vera.id],
  );
});
it('TASK-3/7: два устройства закрывают одно дело, один следующий экземпляр; отмена по событию идемпотентна', async () => {
  const row = await create();
  const responses = await Promise.all([
    adult.post(`/api/tasks/${row.id}/status`, { status: 'done' }),
    adult.post(`/api/tasks/${row.id}/status`, { status: 'done' }),
  ]);
  for (const r of responses) expect(r.status, r.text).toBe(200);
  const done = responses[0]?.json<Task>();
  if (!done) throw new Error('Missing completion');
  expect(done.nextTaskId).toBeTruthy();
  expect(responses[1]?.json<Task>().nextTaskId).toBe(done.nextTaskId);
  expect((await adult.get(`/api/tasks/${done.nextTaskId}`)).json()).toMatchObject({
    planOn: '2026-02-28',
    seriesId: row.seriesId,
  });

  const undo = await Promise.all([
    adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId }),
    adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId }),
  ]);
  for (const r of undo) expect(r.status, r.text).toBe(200);
  expect((await adult.get(`/api/tasks/${row.id}`)).json()).toMatchObject({
    status: 'open',
    nextTaskId: null,
  });
  expect(
    (
      await world.database.admin.query('SELECT deleted_at FROM tasks WHERE id=$1', [
        done.nextTaskId,
      ])
    ).rows[0]?.deleted_at,
  ).not.toBeNull();
  const again = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(again.status, again.text).toBe(200);
  expect(again.json<Task>().completionEventId).not.toBe(done.completionEventId);
});
it('TASK-7: чужое событие и истёкшие семь секунд дают конфликт', async () => {
  const row = await create({ repeatRule: null });
  const done = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  expect((await adult.post(`/api/tasks/${row.id}/undo`, { eventId: randomUUID() })).status).toBe(
    409,
  );
  await world.database.admin.query(
    "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
    [row.id],
  );
  expect(
    (await adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId })).status,
  ).toBe(409);
  expect((await adult.get(`/api/tasks/${row.id}`)).json<Task>().status).toBe('done');
});
it('TASK-3: только этот экземпляр сохраняет шаблон; это и следующие меняют его', async () => {
  const row = await create();
  expect(
    (await adult.request('PATCH', `/api/tasks/${row.id}`, { json: { title: 'Разовое название' } }))
      .status,
  ).toBe(200);
  const first = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  expect((await adult.get(`/api/tasks/${first.nextTaskId}`)).json().title).toBe(
    'Вымышленная серия',
  );
  const updated = await adult.request('PATCH', `/api/tasks/${first.nextTaskId}`, {
    json: { title: 'Новый шаблон', repeatScope: 'following' },
  });
  expect(updated.status, updated.text).toBe(200);
  const second = (
    await adult.post(`/api/tasks/${first.nextTaskId}/status`, { status: 'done' })
  ).json<Task>();
  expect((await adult.get(`/api/tasks/${second.nextTaskId}`)).json()).toMatchObject({
    title: 'Новый шаблон',
    planOn: '2026-03-31',
  });
});
it('TASK-3: три политики просрочки и повтор прохода в местный день', async () => {
  const rows = [];
  for (const policy of ['keep', 'roll_forward', 'not_done'])
    rows.push(
      await create({ planOn: '2026-10-09', repeatRule: { kind: 'daily' }, overduePolicy: policy }),
    );
  const moment = new Date('2026-10-09T19:01:00Z');
  await world.database.worker.query('SELECT app.process_task_overdue($1)', [moment]);
  expect((await adult.get(`/api/tasks/${rows[0]?.id}`)).json()).toMatchObject({
    status: 'open',
    planOn: '2026-10-09',
  });
  expect((await adult.get(`/api/tasks/${rows[1]?.id}`)).json()).toMatchObject({
    status: 'open',
    planOn: '2026-10-10',
  });
  const skipped = (await adult.get(`/api/tasks/${rows[2]?.id}`)).json<Task>();
  expect(skipped.status).toBe('not_done');
  expect((await adult.get(`/api/tasks/${skipped.nextTaskId}`)).json().planOn).toBe('2026-10-10');
  expect(
    (await world.database.worker.query('SELECT app.process_task_overdue($1) AS count', [moment]))
      .rows[0]?.count,
  ).toBe(0);
  await expect(
    world.database.worker.query('SELECT title,repeat_template FROM tasks'),
  ).rejects.toThrow();
});
it('TASK-9: предложенная аудитория, явное подтверждение ребёнку; серии взрослых скрыты', async () => {
  const body = { title: 'Назначение ребёнку', assigneeId: world.vera.id };
  const conflict = await adult.post('/api/tasks', body);
  expect(conflict.status).toBe(409);
  expect(conflict.json()).toMatchObject({
    suggestedPlacement: { spaceId: world.houseId, audience: 'household' },
  });
  const confirmed = await adult.post('/api/tasks', { ...body, expandAudience: true });
  expect(confirmed.status, confirmed.text).toBe(201);
  expect((await child.get(`/api/tasks/${confirmed.json<Task>().id}`)).status).toBe(200);
  const hidden = await create({ placement: { spaceId: world.houseId, audience: 'adults' } });
  expect((await child.get(`/api/tasks/${hidden.id}`)).status).toBe(404);
  expect((await child.get('/api/tasks/plan')).text).not.toContain(hidden.seriesId);
});
it('TASK-4/5: главное дело, календарный курсор, без даты отдельно и одна текущая серия', async () => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Yekaterinburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const row = await create({ planOn: today, repeatRule: { kind: 'daily' } });
  expect((await adult.post(`/api/tasks/${row.id}/main`, { selected: true })).status).toBe(200);
  const feed = await adult.get('/api/tasks/today');
  expect(feed.status, feed.text).toBe(200);
  expect(feed.json<{ main: { id: string } }>().main.id).toBe(row.id);
  const plan = await adult.get('/api/tasks/plan?days=2');
  expect(plan.status, plan.text).toBe(200);
  expect(plan.json().days).toHaveLength(2);
  expect(JSON.stringify(plan.json().days)).toContain(row.id);
});

it('TASK-3: корзина серии восстанавливает только удалённое вместе; отменённый следующий не возвращается', async () => {
  const row = await create();
  const done = (await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })).json<Task>();
  await adult.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId });
  const finished = (
    await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' })
  ).json<Task>();

  const trash = await adult.post(`/api/tasks/${row.id}/series/trash`, {});
  expect(trash.status, trash.text).toBe(200);
  expect((await adult.get('/api/tasks')).text).not.toContain(finished.nextTaskId);
  const restored = await adult.post(`/api/tasks/${row.id}/series/restore`, {});
  expect(restored.status, restored.text).toBe(200);
  expect((await adult.get(`/api/tasks/${finished.nextTaskId}`)).json().deletedAt).toBeNull();
  expect((await adult.get(`/api/tasks/${done.nextTaskId}`)).json().deletedAt).not.toBeNull();
});
it('TASK-10: взять видимый пункт радара явным запросом, гонка не создаёт дубль, источник связан', async () => {
  const obj = (
    await adult.post('/api/objects', {
      title: 'Вымышленный источник радара',
      placement: { spaceId: world.houseId, audience: 'adults' },
    })
  ).json<{ id: string }>();
  const date = new Date().toISOString().slice(0, 10),
    rule = await adult.post(`/api/objects/${obj.id}/deadlines`, { rule: { kind: 'date', date } });
  expect(rule.status, rule.text).toBe(201);
  await refreshDeadlines(createWorkerDatabase(world.database.worker), new Date(), true);
  const radar = (await adult.get(`/api/deadlines?from=${date}&to=${date}`)).json<{
      items: { id: string; objectId: string }[];
    }>(),
    item = radar.items.find((i) => i.objectId === obj.id);
  if (!item) throw new Error('Missing radar fixture');
  expect((await child.post('/api/tasks/from-radar', { occurrenceId: item.id })).status).toBe(404);
  const responses = await Promise.all([
    adult.post('/api/tasks/from-radar', { occurrenceId: item.id }),
    adult.post('/api/tasks/from-radar', { occurrenceId: item.id }),
  ]);
  for (const r of responses) expect(r.status, r.text).toBe(201);
  expect(responses[0]?.json<Task>().id).toBe(responses[1]?.json<Task>().id);
  expect(
    (await adult.get(`/api/records/task/${responses[0]?.json<Task>().id}/links`)).json<unknown[]>(),
  ).toHaveLength(1);
});
it('TASK-11: ответственный объекта, документа и отдельного срока видит запись; история срока и источник независимы', async () => {
  const object = (
    await adult.post('/api/objects', {
      title: 'Объект передачи',
      placement: { spaceId: world.houseId, audience: 'household' },
    })
  ).json<{ id: string }>();
  const assigned = await adult.post(`/api/objects/${object.id}/assignee`, {
    assigneeId: world.vera.id,
  });
  expect(assigned.status, assigned.text).toBe(200);
  const rule = await adult.post(`/api/objects/${object.id}/deadlines`, {
    rule: { kind: 'date', date: '2026-10-20' },
  });
  expect(rule.status, rule.text).toBe(201);
  const deadlineId = rule.json<{ id: string }>().id;
  const transfer = await adult.post(`/api/deadlines/${deadlineId}/assignee`, {
    assigneeId: world.anna.id,
  });
  expect(transfer.status, transfer.text).toBe(200);
  expect(transfer.json()).toMatchObject({ assigneeId: world.anna.id });
  expect((await adult.get(`/api/objects/${object.id}`)).json().assigneeId).toBe(world.vera.id);
  expect(
    (
      await world.database.admin.query('SELECT changes FROM objects_history WHERE record_id=$1', [
        object.id,
      ])
    ).rows.some((r) => r.changes.deadline_assignment),
  ).toBe(true);
  await refreshDeadlines(
    createWorkerDatabase(world.database.worker),
    new Date('2026-10-20T05:00:00Z'),
    true,
  );
  expect(
    (
      await world.database.admin.query(
        'SELECT assignee_id FROM deadline_occurrences WHERE deadline_id=$1',
        [deadlineId],
      )
    ).rows[0]?.assignee_id,
  ).toBe(world.anna.id);
  const privateObject = (
    await adult.post('/api/objects', { title: 'Личный объект передачи' })
  ).json<{ id: string }>();
  expect(
    (await adult.post(`/api/objects/${privateObject.id}/assignee`, { assigneeId: world.anna.id }))
      .status,
  ).toBe(409);
  const doc = await adult.post('/api/documents', {
    title: 'Вымышленный документ передачи',
    placement: { spaceId: world.houseId, audience: 'adults' },
    data: { type: 'other' },
  });
  expect(doc.status, doc.text).toBe(201);
  const docId = doc.json<{ id: string }>().id;
  expect(
    (await adult.post(`/api/documents/${docId}/assignee`, { assigneeId: world.vera.id })).status,
  ).toBe(409);
  expect(
    (await adult.post(`/api/documents/${docId}/assignee`, { assigneeId: world.anna.id })).status,
  ).toBe(200);
});
it('TASK-11: push новому исполнителю и автору после выполнения, без текста; отмена и потеря доступа прекращают доставку', async () => {
  await world.database.admin.query('DELETE FROM deadline_notifications');
  for (const device of [adult, child, admin]) {
    const subscription = await device.post('/api/push/subscriptions', {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: {
        p256dh: webpush.generateVAPIDKeys().publicKey,
        auth: randomBytes(16).toString('base64url'),
      },
      deviceName: 'Вымышленное устройство передачи',
    });
    expect(subscription.status, subscription.text).toBe(201);
    await device.request('PATCH', '/api/notifications/settings', {
      json: { quietStart: '00:00', quietEnd: '00:00', dailyBudget: 100, hideText: true },
    });
  }
  const row = await create({
    planOn: null,
    repeatRule: null,
    placement: { spaceId: world.houseId, audience: 'household' },
    assigneeId: world.vera.id,
  });
  const send = vi.fn<PushSender>().mockResolvedValue(undefined);
  await dispatchNotifications(world.database.worker, send, new Date());
  expect(send.mock.calls.filter((c) => c[1].recordId === row.id)).toHaveLength(1);
  expect(send.mock.calls.find((c) => c[1].recordId === row.id)?.[1].text).toBe(
    'В HomeCRM есть новое',
  );
  const done = await child.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(done.status, done.text).toBe(200);
  await dispatchNotifications(world.database.worker, send, new Date(Date.now() + 10000));
  expect(send.mock.calls.filter((c) => c[1].recordId === row.id)).toHaveLength(2);
  await dispatchNotifications(world.database.worker, send, new Date(Date.now() + 10000));
  expect(send.mock.calls.filter((c) => c[1].recordId === row.id)).toHaveLength(2);
  const pending = await create({
    planOn: null,
    repeatRule: null,
    placement: { spaceId: world.houseId, audience: 'household' },
    assigneeId: world.vera.id,
  });
  const reassigned = await adult.request('PATCH', `/api/tasks/${pending.id}`, {
    json: { assigneeId: world.boris.id },
  });
  expect(reassigned.status, reassigned.text).toBe(200);
  await adult.post(`/api/tasks/${pending.id}/move`, {
    spaceId: world.houseId,
    audience: 'adults',
    confirmed: true,
  });
  await dispatchNotifications(world.database.worker, send, new Date(Date.now() + 10000));
  expect(
    (
      await world.database.admin.query(
        `SELECT d.account_id FROM push_deliveries d JOIN deadline_notifications n ON n.id=d.notification_id WHERE n.record_id=$1 AND d.status='sent'`,
        [pending.id],
      )
    ).rows.every((r) => r.account_id === world.boris.id),
  ).toBe(true);
  const undone = await create({
    planOn: null,
    repeatRule: null,
    placement: { spaceId: world.houseId, audience: 'household' },
    assigneeId: world.vera.id,
  });
  await dispatchNotifications(world.database.worker, send, new Date());
  const finished = (
    await child.post(`/api/tasks/${undone.id}/status`, { status: 'done' })
  ).json<Task>();
  expect(
    (await child.post(`/api/tasks/${undone.id}/undo`, { eventId: finished.completionEventId }))
      .status,
  ).toBe(200);
  await dispatchNotifications(world.database.worker, send, new Date(Date.now() + 10000));
  expect(send.mock.calls.filter((c) => c[1].recordId === undone.id)).toHaveLength(1);
  expect(JSON.stringify(send.mock.calls)).not.toContain('Вымышленная серия');
  const note = await adult.post('/api/notes', {
    title: 'Вымышленный источник назначения срока',
    placement: { spaceId: world.houseId, audience: 'household' },
  });
  expect(note.status, note.text).toBe(201);
  const noteId = note.json<{ id: string }>().id;
  const deadline = await adult.post(`/api/notes/${noteId}/deadlines`, {
    rule: { kind: 'date', date: '2026-10-20' },
  });
  expect(deadline.status, deadline.text).toBe(201);
  const deadlineId = deadline.json<{ id: string }>().id;
  const transfer = await adult.post(`/api/deadlines/${deadlineId}/assignee`, {
    assigneeId: world.vera.id,
  });
  expect(transfer.status, transfer.text).toBe(200);
  await dispatchNotifications(world.database.worker, send, new Date(Date.now() + 10000));
  expect(send.mock.calls.filter((c) => c[1].recordId === noteId)).toHaveLength(1);
  expect(send.mock.calls.some((c) => c[1].recordId === deadlineId)).toBe(false);
});

it('TASK-3: после смены пояса дома повтор после выполнения использует новый местный день', async () => {
  for (const zone of ['Pacific/Kiritimati', 'Etc/GMT+12']) {
    await world.database.admin.query('UPDATE spaces SET time_zone=$1 WHERE id=$2', [
      zone,
      world.houseId,
    ]);
    const row = await create({ repeatRule: { kind: 'after_done', days: 1 } });
    const completed = await adult.post(`/api/tasks/${row.id}/status`, { status: 'done' });
    expect(completed.status, completed.text).toBe(200);
    const done = completed.json<Task & { doneAt: string }>();
    expect((await adult.get(`/api/tasks/${done.nextTaskId}`)).json().planOn).toBe(
      shiftTaskDate(localDate(new Date(done.doneAt), zone), 1),
    );
  }
  await world.database.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [
    world.houseId,
  ]);
});
it('TASK-7/9/11: передача главного дела хранит автора и адресатов; ребёнок отменяет выполненный повтор', async () => {
  const row = await create({ placement: { spaceId: world.houseId, audience: 'adults' } });
  expect((await adult.post(`/api/tasks/${row.id}/main`, { selected: true })).status).toBe(200);
  const transfer = await adult.request('PATCH', `/api/tasks/${row.id}`, {
    json: { assigneeId: world.vera.id, expandAudience: true },
  });
  expect(transfer.status, transfer.text).toBe(200);
  expect(transfer.json()).toMatchObject({
    assigneeId: world.vera.id,
    audience: 'household',
    isMain: false,
  });
  const history = await world.database.admin.query(
    'SELECT actor_id,changes FROM tasks_history WHERE record_id=$1 ORDER BY created_at',
    [row.id],
  );
  expect(
    history.rows.some(
      (r) =>
        r.actor_id === world.boris.id &&
        r.changes.assignee_id?.old === world.boris.id &&
        r.changes.assignee_id?.new === world.vera.id,
    ),
  ).toBe(true);
  const completed = await child.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(completed.status, completed.text).toBe(200);
  const done = completed.json<Task>();
  expect(done.nextTaskId).toBeTruthy();
  const undo = await child.post(`/api/tasks/${row.id}/undo`, { eventId: done.completionEventId });
  expect(undo.status, undo.text).toBe(200);
  expect(undo.json()).toMatchObject({ status: 'open', nextTaskId: null });
});

it('TASK-3/11: новые маршруты не оставляют тексты в журнале URL', () => {
  for (const path of [
    'today',
    'plan',
    'from-radar',
    'private/undo',
    'private/main',
    'private/series/trash',
    'private/series/restore',
  ]) {
    const url = redactUrl(`/api/tasks/${path}?title=private&description=private`);
    expect(url).not.toContain('private');
    expect(url).not.toContain('?');
  }
  expect(redactUrl('/api/deadlines/private/assignee?title=private')).toBe(
    '/api/deadlines/[redacted]/assignee',
  );
});

it('TASK-11: без подписок потерявшее актуальность назначение отменяется фоновым проходом', async () => {
  const row = await create({
    repeatRule: null,
    placement: { spaceId: world.houseId, audience: 'household' },
    assigneeId: world.vera.id,
  });
  const transfer = await adult.request('PATCH', `/api/tasks/${row.id}`, {
    json: { assigneeId: world.boris.id },
  });
  expect(transfer.status, transfer.text).toBe(200);
  await enqueueDeadlineWarnings(createWorkerDatabase(world.database.worker), new Date());
  expect(
    (
      await world.database.admin.query(
        'SELECT status FROM deadline_notifications WHERE record_id=$1 AND recipient_id=$2',
        [row.id, world.vera.id],
      )
    ).rows,
  ).toEqual([{ status: 'cancelled' }]);
});

it('TASK-3: разовая дата, исполнитель и политика не меняют будущие экземпляры', async () => {
  const row = await create({ placement: { spaceId: world.houseId, audience: 'adults' } });
  const one = await adult.request('PATCH', `/api/tasks/${row.id}`, {
    json: {
      planOn: '2026-02-05',
      assigneeId: world.anna.id,
      overduePolicy: 'not_done',
      repeatScope: 'this',
    },
  });
  expect(one.status, one.text).toBe(200);
  const completed = await admin.post(`/api/tasks/${row.id}/status`, { status: 'done' });
  expect(completed.status, completed.text).toBe(200);
  const nextId = completed.json<Task>().nextTaskId;
  expect((await adult.get(`/api/tasks/${nextId}`)).json()).toMatchObject({
    planOn: '2026-02-28',
    assigneeId: world.boris.id,
    overduePolicy: 'keep',
  });
  const following = await adult.request('PATCH', `/api/tasks/${nextId}`, {
    json: {
      planOn: '2026-03-05',
      assigneeId: world.anna.id,
      overduePolicy: 'not_done',
      repeatScope: 'following',
    },
  });
  expect(following.status, following.text).toBe(200);
  const second = await admin.post(`/api/tasks/${nextId}/status`, { status: 'done' });
  expect(second.status, second.text).toBe(200);
  expect((await adult.get(`/api/tasks/${second.json<Task>().nextTaskId}`)).json()).toMatchObject({
    planOn: '2026-03-31',
    assigneeId: world.anna.id,
    overduePolicy: 'not_done',
  });
});
