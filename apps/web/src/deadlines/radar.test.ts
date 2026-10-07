import { DeadlineRule } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import type { RadarItem } from './api.ts';
import {
  buildRows,
  filterRows,
  GROUP_LABELS,
  GROUP_ORDER,
  groupRows,
  type LocatedDeadline,
  type RadarRow,
} from './radar.ts';

const ZONE = 'Europe/Moscow';
// 7 октября 2026, 12:00 в Москве.
const NOW = new Date('2026-10-07T09:00:00Z');
const ME = 'fictional-boris';

function item(id: string, patch: Partial<RadarItem>): RadarItem {
  return {
    id,
    deadlineId: `deadline-${id}`,
    date: '2026-10-10',
    startsAt: '2026-10-10T00:00:00.000Z',
    endsAt: '2026-10-10T20:59:59.999Z',
    timeZone: ZONE,
    spaceId: 'house',
    spaceKind: 'household',
    audience: 'household',
    assigneeId: ME,
    group: '7days',
    ...patch,
  };
}

const located = new Map<string, LocatedDeadline>([
  [
    'deadline-a',
    {
      kind: 'objects',
      sourceId: 'object-1',
      rule: DeadlineRule.parse({ kind: 'date', date: '2026-10-10' }),
    },
  ],
  [
    'deadline-b',
    {
      kind: 'notes',
      sourceId: 'note-1',
      rule: DeadlineRule.parse({
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'year', month: 11, day: 14 },
      }),
    },
  ],
]);
const titles = new Map([
  ['objects:object-1', 'Квартира у парка'],
  ['notes:note-1', 'Страховка'],
]);

function rows(items: RadarItem[]): RadarRow[] {
  return buildRows(items, {
    timeZone: ZONE,
    now: NOW,
    today: '2026-10-07',
    titleOf: (kind, id) => titles.get(`${kind}:${id}`),
    locate: (deadlineId) => located.get(deadlineId),
  });
}

describe('радар: пункты и группы (DEAD-3)', () => {
  it('пункт называет запись, вид срока, дату, значок пространства и ссылку в карточку', () => {
    const [object, note] = rows([
      item('1', { deadlineId: 'deadline-a' }),
      item('2', {
        deadlineId: 'deadline-b',
        spaceKind: 'personal',
        audience: null,
        date: '2026-11-14',
        startsAt: '2026-11-13T21:00:00.000Z',
        endsAt: '2026-11-14T20:59:59.999Z',
        group: '90days',
      }),
    ]) as [RadarRow, RadarRow];
    expect(object).toMatchObject({
      title: 'Квартира у парка',
      visibility: 'household',
      to: '/home/object-1',
      relative: 'через 3 дня',
    });
    expect(object.what).toBe('Дата');
    expect(note).toMatchObject({
      title: 'Страховка',
      visibility: 'personal',
      to: '/more/notes/note-1',
    });
    expect(note.what).toMatch(/^Повтор: ежегодно 14/);
  });

  it('если запись не нашлась, перехода нет, а название пустое', () => {
    const [row] = rows([item('1', { deadlineId: 'unknown' })]);
    expect(row).toMatchObject({ title: null, to: null, what: 'Срок' });
  });

  it('«Моё» оставляет пункты, за которые отвечает участник; «Весь дом» — все видимые', () => {
    const all = rows([
      item('1', { deadlineId: 'deadline-a' }),
      item('2', { deadlineId: 'deadline-b', assigneeId: 'fictional-anna' }),
    ]);
    expect(filterRows(all, { view: 'mine', scope: 'all', meId: ME })).toHaveLength(1);
    expect(filterRows(all, { view: 'house', scope: 'all', meId: ME })).toHaveLength(2);
  });

  it('«Всё · Общее · Личное» фильтрует по пространству пункта', () => {
    const all = rows([
      item('1', { deadlineId: 'deadline-a' }),
      item('2', { deadlineId: 'deadline-b', spaceKind: 'personal', audience: null }),
    ]);
    const kinds = (scope: 'all' | 'shared' | 'personal') =>
      filterRows(all, { view: 'house', scope, meId: ME }).map((row) => row.visibility);
    expect(kinds('all')).toEqual(['household', 'personal']);
    expect(kinds('shared')).toEqual(['household']);
    expect(kinds('personal')).toEqual(['personal']);
  });

  it('группы идут в порядке срочности, внутри группы — по времени', () => {
    expect(GROUP_ORDER.map((group) => GROUP_LABELS[group])).toEqual([
      'Просрочено',
      'Сейчас',
      '7 дней',
      '30 дней',
      '90 дней',
    ]);
    const grouped = groupRows(
      rows([
        item('1', { deadlineId: 'deadline-a', startsAt: '2026-10-12T00:00:00.000Z' }),
        item('2', { deadlineId: 'deadline-a', startsAt: '2026-10-09T00:00:00.000Z' }),
        item('3', {
          deadlineId: 'deadline-a',
          group: 'overdue',
          endsAt: '2026-10-01T20:59:59.999Z',
        }),
      ]),
    );
    expect(grouped['7days'].map((row) => row.id)).toEqual(['2', '1']);
    expect(grouped.overdue.map((row) => row.id)).toEqual(['3']);
    expect(grouped.now).toEqual([]);
  });
});
