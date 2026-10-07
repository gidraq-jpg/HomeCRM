import { type DeadlineOccurrence, type DeadlineRule, deadlineOccurrences } from '@homecrm/shared';
import { todayIn } from '../objects/dates.ts';
import {
  addDays,
  type DateOnly,
  daysBetween,
  formatRelativeDays,
  formatShortDate,
  monthShortName,
  type PluralForms,
  parseDateOnly,
  plural,
} from '../ui/format.ts';

// Подписи сроков по-русски — PRD, раздел 13: «5 окт.», «через 3 дня», правильные формы числа.
// Все даты и время считаются в часовом поясе дома (DEAD-6).

const DASH = String.fromCodePoint(0x2013);

const DAYS: PluralForms = ['день', 'дня', 'дней'];
const MONTHS: PluralForms = ['месяц', 'месяца', 'месяцев'];
const YEARS: PluralForms = ['год', 'года', 'лет'];

const START_OF_DAY = '00:00';
const END_OF_DAY = '23:59';

/** Строку API с датой — в `DateOnly`; всё, что не похоже на дату, не принимается. */
export function asDateOnly(value: string): DateOnly {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Некорректная дата срока');
  return value as DateOnly;
}

/** `09:00` → `9:00`: так часы читаются по-русски. */
export function clockLabel(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return `${Number(hours)}:${minutes}`;
}

/** Время момента в часовом поясе дома: `9:00`. */
export function momentClock(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(moment);
  const hour = parts.find((part) => part.type === 'hour')?.value ?? '0';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${Number(hour)}:${minute}`;
}

/** Число с названием единицы: «3 месяца». */
function count(value: number, forms: PluralForms): string {
  return `${value} ${plural(value, forms)}`;
}

function withTime(text: string, time: string): string {
  return time === START_OF_DAY ? text : `${text} с ${clockLabel(time)}`;
}

function dayRange(day: number, durationDays: number): string {
  return durationDays === 0 ? String(day) : `${day}${DASH}${day + durationDays}`;
}

/** Подпись «за 7 дней», «за 7, 3 и 1 день», «в день срока»; пустая — если предупреждений нет. */
export function describeWarnings(warnings: readonly number[]): string {
  const days = [...new Set(warnings)].sort((a, b) => b - a);
  if (days.length === 0) return '';
  const before = days.filter((day) => day > 0);
  const last = before[before.length - 1];
  if (last === undefined) return 'в день срока';
  const text =
    before.length === 1
      ? `за ${count(last, DAYS)}`
      : `за ${before.slice(0, -1).join(', ')} и ${count(last, DAYS)}`;
  return days.includes(0) ? `${text} и в день срока` : text;
}

function describeRepeat(rule: Extract<DeadlineRule, { kind: 'repeat' }>, today: DateOnly): string {
  const { repeat, durationDays } = rule;
  const span = durationDays + 1;
  if (repeat.unit === 'day') {
    const lead = repeat.every === 1 ? 'каждый день' : `каждые ${count(repeat.every, DAYS)}`;
    const window = durationDays === 0 ? '' : `, окно ${count(span, DAYS)}`;
    return withTime(
      `${lead}, начиная с ${formatShortDate(asDateOnly(rule.anchor), today)}${window}`,
      rule.time,
    );
  }
  if (repeat.unit === 'month') {
    const lead = repeat.every === 1 ? 'каждый месяц' : `каждые ${count(repeat.every, MONTHS)}`;
    const days =
      repeat.day + durationDays <= 31
        ? `${dayRange(repeat.day, durationDays)} числа`
        : `с ${repeat.day} числа, ${count(span, DAYS)}`;
    return withTime(`${lead} ${days}`, rule.time);
  }
  const month = monthShortName(repeat.month);
  const lead = repeat.every === 1 ? 'ежегодно' : `каждые ${count(repeat.every, YEARS)}`;
  const days =
    repeat.day + durationDays <= 28
      ? `${dayRange(repeat.day, durationDays)} ${month}`
      : `${repeat.day} ${month}${durationDays > 0 ? `, ${count(span, DAYS)}` : ''}`;
  return withTime(`${lead} ${days}`, rule.time);
}

/** Человеческая подпись правила: «каждый месяц 20–25 числа с 9:00», «ежегодно 14 нояб.». */
export function describeRule(rule: DeadlineRule, today: DateOnly): string {
  switch (rule.kind) {
    case 'date': {
      const day = formatShortDate(asDateOnly(rule.date), today);
      return rule.time === START_OF_DAY ? day : `${day}, ${clockLabel(rule.time)}`;
    }
    case 'window': {
      const from = formatShortDate(asDateOnly(rule.date), today);
      if (rule.durationDays === 0)
        return `${from}, с ${clockLabel(rule.time)} до ${clockLabel(rule.endTime)}`;
      const to = formatShortDate(addDays(asDateOnly(rule.date), rule.durationDays), today);
      return `с ${from} ${clockLabel(rule.time)} по ${to} ${clockLabel(rule.endTime)}`;
    }
    case 'repeat':
      return describeRepeat(rule, today);
    case 'after': {
      const span = rule.unit === 'day' ? count(rule.every, DAYS) : count(rule.every, MONTHS);
      const event =
        rule.eventDate === null
          ? 'события (даты пока нет)'
          : `события ${formatShortDate(asDateOnly(rule.eventDate), today)}`;
      return withTime(`через ${span} после ${event}`, rule.time);
    }
  }
}

/** Вид срока: что это за срок. */
export const KIND_LABELS = {
  date: 'Дата',
  window: 'Окно',
  repeat: 'Повтор',
  after: 'После события',
} as const;

/**
 * Ближайшее наступление правила на `now`: открытое окно или будущее; а если у разового срока оно
 * уже прошло — само прошедшее (оно просрочено). У повторов прошлых наступлений нет.
 */
export function nextOccurrence(
  rule: DeadlineRule,
  now: Date,
  timeZone: string,
): DeadlineOccurrence | null {
  const all = deadlineOccurrences(rule, now, timeZone, 366, true).sort(
    (a, b) => +a.startsAt - +b.startsAt,
  );
  const open = all.find((item) => item.endsAt >= now);
  if (open) return open;
  return rule.kind === 'repeat' ? null : (all[all.length - 1] ?? null);
}

export interface OccurrenceTiming {
  startsAt: Date;
  endsAt: Date;
  /** Календарная дата начала в поясе дома. */
  date: string;
}

/** «5 окт., 9:00», «20–25 окт.», «5 окт., 9:00–18:00»: когда наступает срок, по поясу дома. */
export function occurrenceWhen(o: OccurrenceTiming, timeZone: string, now: Date): string {
  const today = todayIn(timeZone, now);
  const start = asDateOnly(o.date);
  const end = asDateOnly(todayIn(timeZone, o.endsAt));
  const startClock = momentClock(o.startsAt, timeZone);
  const endClock = momentClock(o.endsAt, timeZone);
  const hasStart = startClock !== clockLabel(START_OF_DAY);
  const hasEnd = endClock !== clockLabel(END_OF_DAY);
  if (start === end) {
    const day = formatShortDate(start, today);
    if (hasEnd) return `${day}, ${startClock}${DASH}${endClock}`;
    return hasStart ? `${day}, ${startClock}` : day;
  }
  if (start.slice(0, 7) === end.slice(0, 7) && !hasStart && !hasEnd)
    return `${parseDateOnly(start).day}${DASH}${formatShortDate(end, today)}`;
  const from = `${formatShortDate(start, today)}${hasStart ? ` ${startClock}` : ''}`;
  const to = `${formatShortDate(end, today)}${hasEnd ? ` ${endClock}` : ''}`;
  return `с ${from} по ${to}`;
}

/** «через 3 дня», «сегодня», «идёт до 25 окт.», «просрочено на 2 дня». */
export function occurrenceRelative(o: OccurrenceTiming, timeZone: string, now: Date): string {
  const today = todayIn(timeZone, now);
  const start = asDateOnly(o.date);
  const end = asDateOnly(todayIn(timeZone, o.endsAt));
  if (o.endsAt < now) {
    const late = daysBetween(end, today);
    return late <= 0 ? 'просрочено' : `просрочено на ${count(late, DAYS)}`;
  }
  if (o.startsAt <= now && start !== end && start < today)
    return `идёт до ${formatShortDate(end, today)}`;
  return formatRelativeDays(daysBetween(today, start));
}
