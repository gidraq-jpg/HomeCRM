import { describe, expect, it, vi } from 'vitest';
import { DeadlineRule, deadlineOccurrences, localDate, radarGroup } from './deadlines.ts';

const zone = 'Asia/Yekaterinburg';
const calc = (rule: unknown, now = '2026-01-01T00:00:00Z', days = 90, tz = zone) =>
  deadlineOccurrences(DeadlineRule.parse(rule), new Date(now), tz, days);
describe('DEAD-1, DEAD-6: календарь дома', () => {
  it('31-е переносится на конец короткого месяца, затем возвращается на 31-е', () => {
    const items = calc(
      { kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 31 } },
      '2026-01-01T00:00:00Z',
      180,
    );
    expect(items.map((x) => x.date)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });
  it('29 февраля високосного года и ежегодный повтор без дрейфа', () => {
    const rule = {
      kind: 'repeat',
      anchor: '2024-01-01',
      repeat: { unit: 'year', month: 2, day: 29 },
    };
    expect(calc(rule, '2024-01-01T00:00:00Z')[0]?.date).toBe('2024-02-29');
    expect(calc(rule, '2025-01-01T00:00:00Z')[0]?.date).toBe('2025-02-28');
    expect(calc(rule, '2028-01-01T00:00:00Z')[0]?.date).toBe('2028-02-29');
  });
  it('окно через полночь и границу месяца, активное окно сохраняется', () => {
    const rule = { kind: 'window', date: '2026-01-31', time: '23:00', endTime: '02:00' };
    const [item] = calc(rule, '2026-01-31T20:00:00Z');
    expect(item?.startsAt.toISOString()).toBe('2026-01-31T18:00:00.000Z');
    expect(item?.endsAt.toISOString()).toBe('2026-01-31T21:00:00.000Z');
    expect(item && radarGroup(item, new Date('2026-01-31T20:00:00Z'), zone)).toBe('now');
    expect(
      calc(
        {
          kind: 'repeat',
          anchor: '2026-01-01',
          repeat: { unit: 'month', day: 31 },
          time: '09:00',
          durationDays: 5,
          endTime: '21:00',
        },
        '2026-02-02T00:00:00Z',
      )[0]?.date,
    ).toBe('2026-01-31');
  });
  it('через N дней/месяцев после события; без события нет наступления', () => {
    expect(calc({ kind: 'after', eventDate: null, every: 1, unit: 'month' })).toEqual([]);
    expect(calc({ kind: 'after', eventDate: '2026-01-31', every: 1, unit: 'month' })[0]?.date).toBe(
      '2026-02-28',
    );
    expect(calc({ kind: 'after', eventDate: '2026-01-31', every: 2, unit: 'day' })[0]?.date).toBe(
      '2026-02-02',
    );
  });
  it('повтор через N после выполнения отсчитывает от нового события', () => {
    const completed = localDate(new Date('2026-01-31T22:00:00Z'), zone);
    expect(calc({ kind: 'after', eventDate: completed, every: 1, unit: 'month' })[0]?.date).toBe(
      '2026-03-01',
    );
  });
  it('движок может сохранить давно просроченное разовое наступление после события', () => {
    const rule = DeadlineRule.parse({
      kind: 'after',
      eventDate: '2020-01-31',
      every: 1,
      unit: 'month',
    });
    expect(deadlineOccurrences(rule, new Date('2026-01-01T00:00:00Z'), zone)).toEqual([]);
    expect(
      deadlineOccurrences(rule, new Date('2026-01-01T00:00:00Z'), zone, 90, true)[0]?.date,
    ).toBe('2020-02-29');
  });
  it('каждые N дней и N месяцев сохраняют якорь на старых правилах', () => {
    const rule = {
      kind: 'repeat',
      anchor: '2000-01-31',
      repeat: { unit: 'month', every: 2, day: 31 },
    };
    expect(calc(rule)[0]?.date).toBe('2026-01-31');
    expect(
      calc(
        { kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'day', every: 5 } },
        '2026-01-06T00:00:00Z',
        10,
      ).map((x) => x.date),
    ).toEqual(['2026-01-06', '2026-01-11', '2026-01-16']);
  });
  it('смена пояса дома меняет моменты, но сохраняет календарную дату', () => {
    const rule = { kind: 'date', date: '2026-02-01', time: '09:00' };
    expect(calc(rule)[0]?.startsAt.toISOString()).toBe('2026-02-01T04:00:00.000Z');
    expect(calc(rule, undefined, 90, 'Europe/Moscow')[0]?.startsAt.toISOString()).toBe(
      '2026-02-01T06:00:00.000Z',
    );
  });
  it('часовой пояс сервера не влияет на расчёт', () => {
    try {
      vi.stubEnv('TZ', 'America/Los_Angeles');
      const first = calc({ kind: 'date', date: '2026-02-01', time: '09:00' });
      vi.stubEnv('TZ', 'Pacific/Auckland');
      expect(calc({ kind: 'date', date: '2026-02-01', time: '09:00' })).toEqual(first);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('предупреждения — календарные дни дома, включая DST', () => {
    const [item] = calc(
      { kind: 'date', date: '2026-03-09', time: '09:00', warnings: [1, 1, 2] },
      '2026-03-01T00:00:00Z',
      90,
      'America/New_York',
    );
    expect(item?.warningsAt.map((x) => x.toISOString())).toEqual([
      '2026-03-07T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
    ]);
  });
  it('границы радара и весь последний день горизонта', () => {
    const now = new Date('2026-01-01T04:00:00Z');
    for (const [date, expected] of [
      ['2025-12-31', 'overdue'],
      ['2026-01-01', 'now'],
      ['2026-01-08', '7days'],
      ['2026-01-31', '30days'],
      ['2026-04-01', '90days'],
      ['2026-04-02', null],
    ] as const) {
      const item = calc({ kind: 'date', date, time: '20:00' }, '2025-12-01T00:00:00Z', 180)[0];
      expect(item && radarGroup(item, now, zone)).toBe(expected);
    }
    expect(calc({ kind: 'date', date: '2026-04-01', time: '23:00' })[0]?.date).toBe('2026-04-01');
  });
  it('границы валидируются схемой без нормализации невозможных дат', () => {
    expect(DeadlineRule.safeParse({ kind: 'date', date: '2026-02-30' }).success).toBe(false);
    expect(
      DeadlineRule.safeParse({ kind: 'date', date: '2026-02-28', time: '24:00' }).success,
    ).toBe(false);
    expect(
      DeadlineRule.safeParse({
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'day', every: 0 },
      }).success,
    ).toBe(false);
  });
});
