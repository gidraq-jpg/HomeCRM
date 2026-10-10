import { z } from 'zod';
import { localDate } from './deadlines.ts';

export const TaskRepeatRule = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('daily') }),
  z.strictObject({
    kind: z.literal('weekly'),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
  }),
  z.strictObject({
    kind: z.literal('monthly'),
    day: z.union([z.number().int().min(1).max(31), z.literal('last')]),
  }),
  z.strictObject({
    kind: z.literal('yearly'),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
  }),
  z.strictObject({ kind: z.literal('every_days'), days: z.number().int().min(1).max(3650) }),
  z.strictObject({ kind: z.literal('after_done'), days: z.number().int().min(1).max(3650) }),
]);
export type TaskRepeatRule = z.infer<typeof TaskRepeatRule>;
export const TaskOverduePolicy = z.enum(['roll_forward', 'not_done', 'keep']);
export type TaskOverduePolicy = z.infer<typeof TaskOverduePolicy>;
/** Календарные даты: никакого прибавления 24 часов к моменту в поясе дома. */
export function shiftTaskDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function clamped(year: number, month: number, day: number | 'last'): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day === 'last' ? last : Math.min(day, last)).padStart(2, '0')}`;
}
/** Следующее календарное наступление строго после опорной даты; после выполнения — после местного дня выполнения. */
export function nextTaskDate(
  rule: TaskRepeatRule,
  previous: string,
  completedAt: Date,
  timeZone: string,
): string {
  if (rule.kind === 'after_done') return shiftTaskDate(localDate(completedAt, timeZone), rule.days);
  if (rule.kind === 'daily') return shiftTaskDate(previous, 1);
  if (rule.kind === 'every_days') return shiftTaskDate(previous, rule.days);
  if (rule.kind === 'weekly') {
    for (let n = 1; n <= 7; n++) {
      const date = shiftTaskDate(previous, n);
      if (rule.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay() || 7)) return date;
    }
    throw new Error('Invalid weekdays');
  }
  const year = Number(previous.slice(0, 4)),
    month = Number(previous.slice(5, 7));
  if (rule.kind === 'monthly') {
    const candidate = clamped(year, month, rule.day);
    return candidate > previous
      ? candidate
      : clamped(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, rule.day);
  }
  const candidate = clamped(year, rule.month, rule.day);
  return candidate > previous ? candidate : clamped(year + 1, rule.month, rule.day);
}
