import { TZDate } from '@date-fns/tz';
import { addDays, addMonths, differenceInCalendarDays, format, getDaysInMonth } from 'date-fns';
import { z } from 'zod';

export const CalendarDate = z.iso.date().brand<'CalendarDate'>();
export type CalendarDate = z.infer<typeof CalendarDate>;
export const TimeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value === 'UTC' || value.includes('/');
  } catch {
    return false;
  }
}, 'Expected an IANA time zone');
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Count = z.number().int().min(1).max(1200);
const warnings = z.array(z.number().int().min(0).max(365)).max(20).default([]);
const duration = z.number().int().min(0).max(366).default(0);
const common = {
  time: Clock.default('00:00'),
  endTime: Clock.optional(),
  durationDays: duration,
  warnings,
  warningTime: Clock.optional(),
  endWarnings: z.array(z.number().int().min(0).max(365)).max(20).optional(),
};
const repeat = z.discriminatedUnion('unit', [
  z.strictObject({
    unit: z.literal('month'),
    every: Count.default(1),
    day: z.number().int().min(1).max(31),
    endDay: z.number().int().min(1).max(31).optional(),
  }),
  z.strictObject({
    unit: z.literal('year'),
    every: Count.default(1),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  z.strictObject({ unit: z.literal('day'), every: Count }),
]);
/** DEAD-1: окно задаётся началом, числом календарных дней и временем конца. */
export const DeadlineRule = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('date'), date: CalendarDate, ...common }),
    z.strictObject({
      kind: z.literal('window'),
      date: CalendarDate,
      ...common,
      endTime: Clock,
      passportYears: z.union([z.literal(20), z.literal(45)]).optional(),
    }),
    z.strictObject({ kind: z.literal('repeat'), anchor: CalendarDate, repeat, ...common }),
    z.strictObject({
      kind: z.literal('after'),
      eventDate: CalendarDate.nullable(),
      every: Count,
      unit: z.enum(['day', 'month']),
      ...common,
    }),
  ])
  .refine(
    (rule) =>
      !(
        rule.kind === 'repeat' &&
        rule.repeat.unit === 'month' &&
        rule.repeat.endDay !== undefined &&
        rule.durationDays > 0
      ),
    'endDay requires durationDays = 0',
  );
export type DeadlineRule = z.infer<typeof DeadlineRule>;
export interface DeadlineOccurrence {
  date: CalendarDate;
  startsAt: Date;
  endsAt: Date;
  warningsAt: Date[];
}
export function localDate(now: Date, timeZone: string): CalendarDate {
  return CalendarDate.parse(format(new TZDate(now, timeZone), 'yyyy-MM-dd'));
}
export function shiftLocalDays(now: Date, days: number, zone: string): Date {
  return new Date(+addDays(new TZDate(now, zone), days));
}
export function calendarInstant(date: CalendarDate, zone: string): Date {
  return new Date(+at(date, '00:00', zone));
}
function at(date: string, clock: string, zone: string): TZDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = clock.split(':').map(Number) as [number, number];
  return new TZDate(y, m - 1, d, h, min, 0, 0, zone);
}
/** Диапазон включителен по локальным датам. Якорь всегда исходный: 31-е не дрейфует после февраля. */
export function deadlineOccurrences(
  input: DeadlineRule,
  now: Date,
  zone: string,
  days = 90,
  includeOverdue = false,
): DeadlineOccurrence[] {
  const rule = DeadlineRule.parse(input);
  TimeZone.parse(zone);
  if (!Number.isInteger(days) || days < 0 || days > 366) throw new RangeError('Invalid horizon');
  const start = at(localDate(now, zone), '00:00', zone);
  const limit = new TZDate(+addDays(start, days + 1) - 1, zone);
  const dates: TZDate[] = [];
  if (rule.kind === 'date' || rule.kind === 'window') dates.push(at(rule.date, rule.time, zone));
  if (rule.kind === 'after' && rule.eventDate !== null) {
    const event = at(rule.eventDate, rule.time, zone);
    dates.push(rule.unit === 'day' ? addDays(event, rule.every) : addMonths(event, rule.every));
  }
  if (rule.kind === 'repeat') {
    const anchor = at(rule.anchor, rule.time, zone);
    const r = rule.repeat;
    if (r.unit === 'day') {
      const index = Math.max(
        0,
        Math.floor(
          differenceInCalendarDays(addDays(start, -rule.durationDays - 1), anchor) / r.every,
        ),
      );
      for (let n = index; ; n++) {
        const date = addDays(anchor, n * r.every);
        if (date > limit) break;
        dates.push(date);
      }
    } else {
      const step = r.every * (r.unit === 'year' ? 12 : 1);
      const base = new TZDate(
        anchor.getFullYear(),
        r.unit === 'year' ? r.month - 1 : anchor.getMonth(),
        1,
        anchor.getHours(),
        anchor.getMinutes(),
        zone,
      );
      const delta =
        (start.getFullYear() - base.getFullYear()) * 12 + start.getMonth() - base.getMonth();
      const index = Math.max(0, Math.floor((delta - 13) / step));
      for (let n = index; ; n++) {
        const month = addMonths(base, n * step);
        month.setDate(Math.min(r.day, getDaysInMonth(month)));
        if (month > limit) break;
        if (month >= anchor) dates.push(month);
      }
    }
  }
  return dates.flatMap((date) => {
    let end = addDays(date, rule.durationDays);
    if (
      rule.kind === 'repeat' &&
      rule.repeat.unit === 'month' &&
      rule.repeat.endDay !== undefined
    ) {
      const r = rule.repeat;
      const endDay = rule.repeat.endDay;
      end = new TZDate(
        date.getFullYear(),
        date.getMonth() + (endDay < r.day ? 1 : 0),
        1,
        date.getHours(),
        date.getMinutes(),
        zone,
      );
      end.setDate(Math.min(endDay, getDaysInMonth(end)));
    }
    if (rule.endTime !== undefined) {
      end = at(format(end, 'yyyy-MM-dd'), rule.endTime, zone);
      if (end < date) end = addDays(end, 1);
    } else {
      // Дата без времени остаётся актуальной до конца локального дня.
      end = at(format(addDays(end, 1), 'yyyy-MM-dd'), '00:00', zone);
      end = new TZDate(+end - 1, zone);
    }
    if ((end < start && !(includeOverdue && rule.kind !== 'repeat')) || date > limit) return [];
    return [
      {
        date: CalendarDate.parse(format(date, 'yyyy-MM-dd')),
        startsAt: new Date(+date),
        endsAt: new Date(+end),
        warningsAt: [
          ...new Set([
            ...rule.warnings.map(
              (n) =>
                +addDays(
                  rule.warningTime ? at(format(date, 'yyyy-MM-dd'), rule.warningTime, zone) : date,
                  -n,
                ),
            ),
            ...(rule.endWarnings ?? []).map(
              (n) =>
                +addDays(at(format(end, 'yyyy-MM-dd'), rule.warningTime ?? rule.time, zone), -n),
            ),
          ]),
        ]
          .sort((a, b) => a - b)
          .map((n) => new Date(n)),
      },
    ];
  });
}
export const RADAR_GROUPS = ['overdue', 'now', '7days', '30days', '90days', 'later'] as const;
export function radarGroup(
  occurrence: Pick<DeadlineOccurrence, 'startsAt' | 'endsAt'>,
  now: Date,
  zone: string,
): (typeof RADAR_GROUPS)[number] | null {
  if (occurrence.endsAt < now) return 'overdue';
  const days = differenceInCalendarDays(
    new TZDate(occurrence.startsAt, zone),
    new TZDate(now, zone),
  );
  if (occurrence.startsAt <= now || days === 0) return 'now';
  return days <= 7 ? '7days' : days <= 30 ? '30days' : days <= 90 ? '90days' : null;
}
