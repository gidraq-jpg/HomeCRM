import type { DateOnly } from '../ui/format.ts';

/** Сегодняшняя календарная дата в часовом поясе дома: `2026-10-07`. */
export function todayIn(timeZone: string, now: Date = new Date()): DateOnly {
  // Формат en-CA даёт «год-месяц-день» с ведущими нулями.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now) as DateOnly;
}
