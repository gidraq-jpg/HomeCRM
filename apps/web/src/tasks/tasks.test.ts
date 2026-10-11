import { parseQuickline, TaskFields } from '@homecrm/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTasks, TaskCard, TaskError, taskRequest, undoWindow } from './api.ts';
import { createBody } from './NewTaskScreen.tsx';
import { quickDraft } from './Quickline.tsx';
import { uniqueTasks } from './queries.ts';
import { taskChange, taskDraft } from './TaskForm.tsx';

const account = '00000000-0000-4000-8000-000000000001';
const house = '00000000-0000-4000-8000-000000000002';
function card() {
  return TaskCard.parse({
    ...TaskFields.parse({ title: 'Вымышленное дело' }),
    id: crypto.randomUUID(),
    spaceId: account,
    spaceKind: 'personal',
    audience: null,
    authorId: account,
    assigneeId: account,
    householdId: house,
    createdAt: '2026-10-10T00:00:00Z',
    updatedAt: '2026-10-10T00:00:00Z',
    deletedAt: null,
    files: [],
    waitingFrom: null,
    seriesId: null,
    isMain: false,
    doneAt: null,
    dueAt: null,
    radarOccurrenceId: null,
    completionEventId: null,
    completionUndoneAt: null,
    nextTaskId: null,
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('дела: черновик и контракт', () => {
  it('обычная правка скрытого адресата не посылает null и не переписывает расписание', () => {
    const base = card();
    base.status = 'waiting';
    base.checkOn = TaskFields.shape.checkOn.parse('2026-10-11');
    base.repeatRule = { kind: 'daily' };
    base.planOn = TaskFields.shape.planOn.parse('2026-10-10');
    const draft = taskDraft(base, 'personal');
    draft.description = 'Мой черновик';
    expect(taskChange(draft, base)).toEqual({
      description: 'Мой черновик',
      expectedUpdatedAt: base.updatedAt,
      repeatScope: 'this',
    });
  });
  it('прекращение повтора и новый адресат входят только в изменённые поля', () => {
    const base = card();
    base.repeatRule = { kind: 'daily' };
    const draft = taskDraft(base, 'personal');
    draft.repeatRule = null;
    draft.repeatScope = 'following';
    draft.waitingAccountId = account;
    expect(taskChange(draft, base)).toEqual({
      repeatRule: null,
      repeatScope: 'following',
      waitingAccountId: account,
      expectedUpdatedAt: base.updatedAt,
    });
  });
  it('личное создание с объектом явно сохраняет личное размещение', () => {
    const base = card();
    const draft = taskDraft(base, 'personal');
    draft.objectId = house;
    const body = createBody(draft, account);
    expect(body.placement).toEqual({ spaceId: account });
    expect(body.objectId).toBe(house);
    expect(body).not.toHaveProperty('repeatScope');
  });
  it('снятый чип возвращается в название и не распознаётся при повторном рендере', () => {
    const raw = 'Позвонить завтра в 10:00 @Вера #Квартира';
    const parsed = parseQuickline(raw, {
      now: new Date('2026-10-09T22:30:00Z'),
      timeZone: 'Asia/Yekaterinburg',
      members: [{ id: account, name: 'Вера' }],
      objects: [{ id: house, name: 'Квартира' }],
    });
    expect(parsed.planOn).toBe('2026-10-11');
    const date = parsed.fragments.find((fragment) => fragment.kind === 'date');
    const draft = quickDraft(raw, parsed, new Set([`date:${date?.text}`]), {});
    expect(draft.title).toBe('Позвонить завтра');
    expect(draft.planOn).toBeNull();
    expect(draft.planTime).toBe('10:00');
    expect(draft.assigneeId).toBe(account);
    expect(draft.objectId).toBe(house);
    expect(raw).toBe('Позвонить завтра в 10:00 @Вера #Квартира');
  });
  it('ручная правка чипа не теряет неизвестное имя в названии', () => {
    const raw = 'Позвонить завтра @Незнакомый';
    const parsed = parseQuickline(raw, {
      now: new Date('2026-10-10T12:00:00Z'),
      timeZone: 'UTC',
      members: [],
      objects: [],
    });
    const draft = quickDraft(raw, parsed, new Set(), { date: '2026-10-12' });
    expect(draft.title).toBe('Позвонить @Незнакомый');
    expect(draft.planOn).toBe('2026-10-12');
  });
  it('слияние страниц не дублирует записи и сохраняет последнюю версию', () => {
    expect(
      uniqueTasks([
        { id: '1', title: 'До' },
        { id: '2', title: 'Другое' },
        { id: '1', title: 'После' },
      ]),
    ).toEqual([
      { id: '1', title: 'После' },
      { id: '2', title: 'Другое' },
    ]);
  });
});
describe('дела: сеть, конфликт и окно отмены', () => {
  it('фильтры с undefined не превращаются в параметры API', async () => {
    const fetch = vi.fn(async (_url: string) => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await fetchTasks('all', { filter: 'undated', status: undefined, objectId: undefined }, 50);
    const url = String(fetch.mock.calls[0]?.[0]);
    expect(url).toContain('filter=undated');
    expect(url).not.toContain('undefined');
    expect(url).toContain('offset=50');
  });
  it('409 назначения сохраняет предложение, а null запрещает подтверждение', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            code: 'ASSIGNEE_NOT_VISIBLE',
            suggestedPlacement: { spaceId: house, audience: 'household' },
          }),
          { status: 409 },
        ),
    );
    try {
      await taskRequest('POST', 'tasks', TaskCard, {});
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(TaskError);
      expect((error as TaskError).suggestedPlacement).toEqual({
        spaceId: house,
        audience: 'household',
      });
    }
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ code: 'ASSIGNEE_NOT_VISIBLE', suggestedPlacement: null }), {
          status: 409,
        }),
    );
    await expect(taskRequest('POST', 'tasks', TaskCard, {})).rejects.toMatchObject({
      suggestedPlacement: null,
      status: 409,
    });
  });
  it('окно использует дату сервера, учитывает точность HTTP Date и транспорт', () => {
    expect(undoWindow('2026-10-10T12:00:00.500Z', 'Sat, 10 Oct 2026 12:00:01 GMT', 250)).toBe(5251);
    expect(undoWindow('2026-10-10T12:00:00Z', 'Sat, 10 Oct 2026 12:00:07 GMT', 0)).toBe(0);
    expect(undoWindow(null, 'Sat, 10 Oct 2026 12:00:00 GMT', 0)).toBe(0);
    expect(undoWindow('2026-10-10T12:00:00Z', null, 0)).toBe(0);
  });
});
