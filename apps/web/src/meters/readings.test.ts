import { MeterData } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import type { MeterListItem, ReadingCard } from './api.ts';
import { blockingDate, buildPayload, emptyDraft, evaluateMeter } from './readings.ts';

function meter(
  id: string,
  zones: string[],
  previous: string[] | null,
  on = '2026-09-20',
): MeterListItem {
  const reading: ReadingCard | null =
    previous === null
      ? null
      : {
          id: `r-${id}`,
          title: 'Показание',
          spaceId: 's',
          spaceKind: 'household',
          audience: 'adults',
          authorId: 'u',
          assigneeId: null,
          createdAt: '2026-09-20T10:00:00.000Z',
          updatedAt: '2026-09-20T10:00:00.000Z',
          deletedAt: null,
          parentId: id,
          occurredOn: on,
          values: previous,
          consumption: null,
          rollover: false,
          comment: '',
          takenBy: 'u',
          transmissionStatus: 'pending',
          transmittedAt: null,
          transmissionMethod: null,
          photoIds: [],
          warnings: [],
        };
  return {
    id,
    title: `Счётчик ${id}`,
    spaceId: 's',
    spaceKind: 'household',
    audience: 'adults',
    authorId: 'u',
    assigneeId: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    deletedAt: null,
    parentId: 'o',
    utilityAccountId: null,
    previousMeterId: null,
    data: MeterData.parse({ resource: 'cold_water', zones }),
    previousReading: reading,
  };
}

describe('ввод показаний по счётчику', () => {
  const cold = meter('a', ['Основная'], ['100.000']);

  it('пустой счётчик пропускается, заполненный даёт расход', () => {
    expect(evaluateMeter(cold, undefined).entered).toBe(false);
    const entry = evaluateMeter(cold, { values: ['110,5'], rollover: false });
    expect(entry).toMatchObject({ entered: true, valid: true, values: ['110.500'] });
    expect(entry.consumption).toEqual(['10.500']);
  });

  it('меньше прошлого — ошибка у поля и выбор; переход через ноль её снимает', () => {
    const lower = evaluateMeter(cold, { values: ['90'], rollover: false });
    expect(lower).toMatchObject({ valid: false, lower: true, anyLower: true });
    expect(lower.problems[0]).toBe('Меньше прошлого: 100,000');
    const wrapped = evaluateMeter(cold, { values: ['90'], rollover: true });
    expect(wrapped).toMatchObject({ valid: true, lower: false, anyLower: true });
    expect(wrapped.consumption).toEqual(['99990.000']);
  });

  it('у многотарифного счётчика заполняются все зоны', () => {
    const power = meter('b', ['День', 'Ночь'], ['10.000', '20.000']);
    const partial = evaluateMeter(power, { values: ['15', ''], rollover: false });
    expect(partial.valid).toBe(false);
    expect(partial.problems[1]).toContain('«Ночь»');
    expect(evaluateMeter(power, { values: ['15', '25'], rollover: false }).valid).toBe(true);
  });
});

describe('пакет «Сохранить всё»', () => {
  const a = meter('a', ['Основная'], ['100.000']);
  const b = meter('b', ['Основная'], null);
  const c = meter('c', ['Основная'], ['5.000']);

  it('в пакет идут только заполненные счётчики; переход через ноль — только если он нужен', () => {
    const payload = buildPayload(
      [a, b, c],
      {
        a: { values: ['110'], rollover: true },
        b: { values: ['7'], rollover: false },
      },
      '2026-10-20',
      { b: ['file-1'] },
    );
    expect(payload.invalid).toEqual([]);
    expect(payload.readings).toEqual([
      { meterId: 'a', occurredOn: '2026-10-20', values: ['110.000'] },
      { meterId: 'b', occurredOn: '2026-10-20', values: ['7.000'], photoIds: ['file-1'] },
    ]);
  });

  it('счётчики с ошибками перечисляются, остальные не теряются', () => {
    const payload = buildPayload(
      [a, c],
      { a: { values: ['abc'], rollover: false }, c: { values: ['6'], rollover: false } },
      '2026-10-20',
      {},
    );
    expect(payload.invalid).toEqual(['a']);
    expect(payload.readings.map((reading) => reading.meterId)).toEqual(['c']);
  });

  it('дата должна быть позже прошлого показания введённых счётчиков', () => {
    const drafts = { a: { values: ['110'], rollover: false } };
    expect(blockingDate([a, c], drafts, '2026-09-20')).toBe('2026-09-20');
    expect(blockingDate([a, c], drafts, '2026-09-21')).toBeNull();
    // Счётчик, по которому ничего не введено, дате не мешает.
    expect(blockingDate([a, c], { c: emptyDraft(1) }, '2026-09-01')).toBeNull();
  });
});
