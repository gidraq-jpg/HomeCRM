import { periodLabel } from '../charges/labels.ts';
import { monthShortName } from '../ui/format.ts';
import type { AccountStatus } from './api.ts';

// Расчётные месяцы вида `2026-10` — календарные, без часового пояса.

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && MONTH.test(value);
}

/** Месяц сегодняшней даты в часовом поясе дома: `2026-10-07` → `2026-10`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Сдвиг на `delta` месяцев: `2026-01` и −1 → `2025-12`. */
export function shiftMonth(month: string, delta: number): string {
  const match = MONTH.exec(month);
  if (!match) return month;
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const number = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(number).padStart(2, '0')}`;
}

/** «Октябрь 2026». */
export const monthName = periodLabel;

/** Короткая подпись для таблиц: «окт. 2026». */
export function monthShort(month: string): string {
  const match = MONTH.exec(month);
  return match ? `${monthShortName(Number(match[2]))} ${match[1]}` : month;
}

export const STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  transmitted: 'Показания переданы',
  not_transmitted: 'Показания не переданы',
  not_open: 'Окно показаний ещё не открылось',
  not_required: 'Передача не требуется',
};

export const STATUS_TONES: Readonly<Record<AccountStatus, 'ok' | 'warning' | 'neutral'>> = {
  transmitted: 'ok',
  not_transmitted: 'warning',
  not_open: 'neutral',
  not_required: 'neutral',
};
