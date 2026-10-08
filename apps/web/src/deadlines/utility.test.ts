import { describe, expect, it } from 'vitest';
import type { MeterListItem } from '../meters/api.ts';
import type { RadarRow } from './radar.ts';
import {
  isOpenWindow,
  metersWithoutText,
  openWindowObjectIds,
  progressText,
  untilText,
  windowCards,
  windowProgress,
} from './utility.ts';

const WINDOW = { accountId: 'account-1', startDate: '2026-10-20', endDate: '2026-10-25' } as const;

function meter(
  id: string,
  reading: { on: string; sent: boolean } | null,
  over = {},
): MeterListItem {
  return {
    id,
    utilityAccountId: 'account-1',
    data: { status: 'active' },
    previousReading: reading
      ? {
          occurredOn: reading.on,
          transmissionStatus: reading.sent ? 'transmitted' : 'pending',
        }
      : null,
    ...over,
  } as unknown as MeterListItem;
}

function row(id: string, objectId: string, title: string, over: Partial<RadarRow> = {}) {
  return {
    id,
    group: 'now',
    title,
    visibility: 'adults',
    utility: { kind: 'readings', objectId, status: 'rented', endDate: '2026-10-25' },
    ...over,
  } as unknown as RadarRow;
}

describe('окно показаний: тексты (PRD 13)', () => {
  it('«до 25 окт.» и формы множественного числа', () => {
    expect(untilText('2026-10-25', '2026-10-21')).toBe(`до 25${String.fromCodePoint(0xa0)}окт.`);
    const word = (count: number) =>
      metersWithoutText(count).replace(String.fromCodePoint(0xa0), ' ');
    expect(word(1)).toBe('1 счётчик без показаний');
    expect(word(2)).toBe('2 счётчика без показаний');
    expect(word(5)).toBe('5 счётчиков без показаний');
    expect(word(21)).toBe('21 счётчик без показаний');
  });
});

describe('окно показаний: сколько счётчиков ещё без показаний', () => {
  it('считает только активные счётчики счёта; показание вне окна не считается', () => {
    const progress = windowProgress(
      [
        meter('a', { on: '2026-10-21', sent: true }),
        meter('b', { on: '2026-09-20', sent: true }),
        meter('c', null),
        meter('d', { on: '2026-10-22', sent: false }),
        meter('other-account', null, { utilityAccountId: 'account-2' }),
        meter('removed', null, { data: { status: 'removed' } }),
      ],
      WINDOW,
    );
    expect(progress).toEqual({ total: 4, missing: 2, untransmitted: 1 });
    expect(progressText(progress)).toContain('2');
  });

  it('все внесены, но не переданы — подсказка передать; всё готово — строки нет', () => {
    expect(progressText({ total: 1, missing: 0, untransmitted: 1 })).toBe(
      'Показания внесены, осталось передать',
    );
    expect(progressText({ total: 1, missing: 0, untransmitted: 0 })).toBeNull();
  });
});

describe('карточки открытых окон', () => {
  it('одна карточка на объект; будущие окна и другие сроки в неё не попадают', () => {
    const rows = [
      row('1', 'object-b', 'Дача'),
      row('2', 'object-a', 'Квартира у парка'),
      row('3', 'object-a', 'Квартира у парка'),
      row('4', 'object-c', 'Гараж', { group: '7days' }),
      row('5', 'object-a', 'Квартира у парка', {
        utility: { kind: 'payment', objectId: 'object-a' } as RadarRow['utility'],
      }),
    ];
    const cards = windowCards(rows);
    expect(cards.map((card) => [card.title, card.windows.length])).toEqual([
      ['Дача', 1],
      ['Квартира у парка', 2],
    ]);
    expect(rows.filter(isOpenWindow)).toHaveLength(3);
    expect([...openWindowObjectIds(rows)].sort()).toEqual(['object-a', 'object-b']);
  });
});
