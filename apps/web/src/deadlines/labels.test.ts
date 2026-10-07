import { DeadlineRule } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import {
  describeRule,
  describeWarnings,
  nextOccurrence,
  occurrenceRelative,
  occurrenceWhen,
} from './labels.ts';

const ZONE = 'Europe/Moscow';
const TODAY = '2026-10-07';
// 7 октября 2026, 12:00 в Москве.
const NOW = new Date('2026-10-07T09:00:00Z');

/** Текст без неразрывных пробелов: так проверять даты проще. */
const plain = (value: string) => value.replaceAll(String.fromCodePoint(0xa0), ' ');
const rule = (value: unknown) => DeadlineRule.parse(value);
const text = (value: unknown) => plain(describeRule(rule(value), TODAY));

describe('подписи правил (DEAD-1)', () => {
  it('дата: «5 окт.», время — через запятую, чужой год дописывается', () => {
    expect(text({ kind: 'date', date: '2026-10-05' })).toBe('5 окт.');
    expect(text({ kind: 'date', date: '2026-10-05', time: '09:30' })).toBe('5 окт., 9:30');
    expect(text({ kind: 'date', date: '2027-01-14' })).toBe('14 янв. 2027');
  });

  it('окно: «с — по» со временем начала и конца', () => {
    expect(
      text({
        kind: 'window',
        date: '2026-10-20',
        time: '09:00',
        durationDays: 5,
        endTime: '18:00',
      }),
    ).toBe('с 20 окт. 9:00 по 25 окт. 18:00');
    expect(
      text({
        kind: 'window',
        date: '2026-10-20',
        time: '09:00',
        durationDays: 0,
        endTime: '18:00',
      }),
    ).toBe('20 окт., с 9:00 до 18:00');
  });

  it('повтор по месяцам: «каждый месяц 20–25 числа с 9:00»', () => {
    const monthly = (extra: object) => ({
      kind: 'repeat',
      anchor: '2026-01-01',
      time: '09:00',
      ...extra,
    });
    expect(text(monthly({ repeat: { unit: 'month', day: 20 }, durationDays: 5 }))).toBe(
      'каждый месяц 20–25 числа с 9:00',
    );
    expect(text({ kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 15 } })).toBe(
      'каждый месяц 15 числа',
    );
    expect(
      text({ kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 10, every: 2 } }),
    ).toBe('каждые 2 месяца 10 числа');
    expect(
      text({ kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'month', day: 10, every: 5 } }),
    ).toBe('каждые 5 месяцев 10 числа');
  });

  it('повтор по годам и дням', () => {
    expect(
      text({ kind: 'repeat', anchor: '2026-01-01', repeat: { unit: 'year', month: 11, day: 14 } }),
    ).toBe('ежегодно 14 нояб.');
    expect(
      text({
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'year', month: 3, day: 1, every: 2 },
      }),
    ).toBe('каждые 2 года 1 мар.');
    expect(text({ kind: 'repeat', anchor: '2026-10-05', repeat: { unit: 'day', every: 10 } })).toBe(
      'каждые 10 дней, начиная с 5 окт.',
    );
    expect(text({ kind: 'repeat', anchor: '2026-10-05', repeat: { unit: 'day', every: 1 } })).toBe(
      'каждый день, начиная с 5 окт.',
    );
  });

  it('«через N после события»: с датой события и без неё', () => {
    expect(text({ kind: 'after', eventDate: '2026-10-05', every: 3, unit: 'month' })).toBe(
      'через 3 месяца после события 5 окт.',
    );
    expect(text({ kind: 'after', eventDate: null, every: 14, unit: 'day' })).toBe(
      'через 14 дней после события (даты пока нет)',
    );
  });

  it('предупреждения: «за 7 дней», «за 7, 3 и 1 день», «в день срока»', () => {
    expect(describeWarnings([])).toBe('');
    expect(describeWarnings([7])).toBe('за 7 дней');
    expect(describeWarnings([1])).toBe('за 1 день');
    expect(describeWarnings([2])).toBe('за 2 дня');
    expect(describeWarnings([1, 7, 3])).toBe('за 7, 3 и 1 день');
    expect(describeWarnings([0])).toBe('в день срока');
    expect(describeWarnings([7, 0])).toBe('за 7 дней и в день срока');
    expect(describeWarnings([7, 7])).toBe('за 7 дней');
  });
});

describe('ближайшее наступление и подписи времени (DEAD-6)', () => {
  it('повтор: ближайшая дата в будущем, у разовой прошедшей — она сама', () => {
    const monthly = rule({
      kind: 'repeat',
      anchor: '2026-01-01',
      repeat: { unit: 'month', day: 20 },
    });
    expect(nextOccurrence(monthly, NOW, ZONE)?.date).toBe('2026-10-20');
    const past = rule({ kind: 'date', date: '2026-10-02' });
    expect(nextOccurrence(past, NOW, ZONE)?.date).toBe('2026-10-02');
    const waiting = rule({ kind: 'after', eventDate: null, every: 3, unit: 'month' });
    expect(nextOccurrence(waiting, NOW, ZONE)).toBeNull();
  });

  it('когда и сколько осталось', () => {
    const at = (value: unknown) => {
      const found = nextOccurrence(rule(value), NOW, ZONE);
      if (!found) throw new Error('Нет наступления');
      return found;
    };
    const soon = at({ kind: 'date', date: '2026-10-10', time: '09:00' });
    expect(plain(occurrenceWhen(soon, ZONE, NOW))).toBe('10 окт., 9:00');
    expect(occurrenceRelative(soon, ZONE, NOW)).toBe('через 3 дня');

    const today = at({ kind: 'date', date: TODAY });
    expect(occurrenceRelative(today, ZONE, NOW)).toBe('сегодня');

    const late = at({ kind: 'date', date: '2026-10-02' });
    expect(occurrenceRelative(late, ZONE, NOW)).toBe('просрочено на 5 дней');

    const open = at({
      kind: 'repeat',
      anchor: '2026-01-01',
      repeat: { unit: 'month', day: 5 },
      durationDays: 5,
    });
    expect(plain(occurrenceWhen(open, ZONE, NOW))).toBe('5–10 окт.');
    expect(plain(occurrenceRelative(open, ZONE, NOW))).toBe('идёт до 10 окт.');
  });

  it('время считается по поясу дома, а не по поясу браузера', () => {
    const date = rule({ kind: 'date', date: '2026-10-10', time: '23:30' });
    const event = nextOccurrence(date, NOW, 'Asia/Yekaterinburg');
    if (!event) throw new Error('Нет наступления');
    expect(plain(occurrenceWhen(event, 'Asia/Yekaterinburg', NOW))).toBe('10 окт., 23:30');
    // 23:30 в Екатеринбурге (UTC+5) — это 18:30 UTC, а не время браузера.
    expect(event.startsAt.toISOString()).toBe('2026-10-10T18:30:00.000Z');
  });
});
