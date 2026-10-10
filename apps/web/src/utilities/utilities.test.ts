import { describe, expect, it } from 'vitest';
import {
  consumptionIn,
  hasData,
  maxOf,
  ratio,
  resourcesOf,
  resourceTitle,
  showConsumption,
} from './analytics.ts';
import { AnalyticsMonth, MonthOverview } from './api.ts';
import { isMonth, monthName, monthOf, monthShort, shiftMonth } from './months.ts';

describe('расчётные месяцы', () => {
  it('сдвиг через границу года', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
    expect(shiftMonth('плохо', 1)).toBe('плохо');
  });

  it('проверка и подписи', () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth(null)).toBe(false);
    expect(monthOf('2026-10-09')).toBe('2026-10');
    expect(monthName('2026-10')).toBe('Октябрь 2026');
    expect(monthShort('2026-10')).toBe('окт. 2026');
  });
});

describe('ответы месяца и аналитики', () => {
  it('месяц разбирается как в контракте', () => {
    const parsed = MonthOverview.parse({
      month: '2026-10',
      objects: [
        {
          id: 'a',
          title: 'Квартира',
          spaceId: 'house',
          spaceKind: 'household',
          audience: 'adults',
          chargedCents: 10000,
          paidCents: 4000,
          remainingCents: 6000,
          accounts: [{ id: 'b', title: 'Счёт', status: 'not_transmitted' }],
        },
      ],
      totals: { chargedCents: 10000, paidCents: 4000, remainingCents: 6000 },
    });
    expect(parsed.objects[0]?.accounts[0]?.status).toBe('not_transmitted');
  });

  it('неизвестный статус отвергается: экран не гадает', () => {
    expect(() =>
      MonthOverview.parse({
        month: '2026-10',
        objects: [
          {
            id: 'a',
            title: 'Квартира',
            chargedCents: 0,
            paidCents: 0,
            remainingCents: 0,
            accounts: [{ id: 'b', title: 'Счёт', status: 'other' }],
          },
        ],
        totals: { chargedCents: 0, paidCents: 0, remainingCents: 0 },
      }),
    ).toThrow();
  });

  const month = (patch: Partial<AnalyticsMonth> = {}): AnalyticsMonth =>
    AnalyticsMonth.parse({
      month: '2026-10',
      chargedCents: 0,
      paidCents: 0,
      consumption: [],
      previousYear: { month: '2025-10', chargedCents: 0, paidCents: 0, consumption: [] },
      ...patch,
    });

  it('расход остаётся точной строкой, без округления', () => {
    const m = month({
      consumption: [{ resource: 'electricity', unit: 'кВт·ч', value: '123.4560' }],
    });
    expect(consumptionIn(m.consumption, { resource: 'electricity', unit: 'кВт·ч' })).toBe(
      '123.4560',
    );
    expect(showConsumption('123.4560')).toBe('123,4560');
    expect(showConsumption(null)).toBe('—');
  });

  it('ресурсы — в порядке справочника, с расходом и прошлого года', () => {
    const m = month({
      consumption: [{ resource: 'electricity', unit: 'кВт·ч', value: '5' }],
      previousYear: {
        month: '2025-10',
        chargedCents: 0,
        paidCents: 0,
        consumption: [{ resource: 'cold_water', unit: 'м³', value: '2.5' }],
      },
    });
    expect(resourcesOf([m]).map(resourceTitle)).toEqual(['ХВС, м³', 'Электроэнергия, кВт·ч']);
  });

  it('пустая аналитика распознаётся', () => {
    expect(hasData([month(), month({ month: '2026-09' })])).toBe(false);
    expect(hasData([month({ paidCents: 1 })])).toBe(true);
  });

  it('высота столбца — доля максимума', () => {
    expect(ratio(50, 100)).toBe(0.5);
    expect(ratio(0, 100)).toBe(0);
    expect(ratio(5, 0)).toBe(0);
    expect(maxOf([1, 7, 3])).toBe(7);
  });
});
