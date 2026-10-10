import { expect, it } from 'vitest';
import { nextTaskDate, TaskRepeatRule } from './task-repeats.ts';

const completed = new Date('2026-12-31T22:00:00Z');
it.each([
  [{ kind: 'daily' }, '2026-12-31', '2027-01-01'],
  [{ kind: 'weekly', weekdays: [1, 5] }, '2026-12-31', '2027-01-01'],
  [{ kind: 'weekly', weekdays: [1] }, '2026-12-28', '2027-01-04'],
  [{ kind: 'monthly', day: 31 }, '2026-01-31', '2026-02-28'],
  [{ kind: 'monthly', day: 31 }, '2026-02-28', '2026-03-31'],
  [{ kind: 'monthly', day: 'last' }, '2028-01-31', '2028-02-29'],
  [{ kind: 'monthly', day: 1 }, '2026-12-31', '2027-01-01'],
  [{ kind: 'yearly', month: 2, day: 29 }, '2024-02-29', '2025-02-28'],
  [{ kind: 'yearly', month: 2, day: 29 }, '2027-02-28', '2028-02-29'],
  [{ kind: 'every_days', days: 3 }, '2026-12-30', '2027-01-02'],
  [{ kind: 'after_done', days: 2 }, '2026-01-01', '2027-01-03'],
])('TASK-3: %j, %s → %s', (rule, previous, next) => {
  expect(nextTaskDate(TaskRepeatRule.parse(rule), previous, completed, 'Asia/Yekaterinburg')).toBe(
    next,
  );
});
it('TASK-3: день выполнения меняется вместе с поясом дома; расписание остаётся календарным', () => {
  const rule = TaskRepeatRule.parse({ kind: 'after_done', days: 1 });
  expect(nextTaskDate(rule, '2026-01-01', completed, 'UTC')).toBe('2027-01-01');
  expect(nextTaskDate(rule, '2026-01-01', completed, 'Asia/Yekaterinburg')).toBe('2027-01-02');
  expect(() => TaskRepeatRule.parse({ kind: 'weekly', weekdays: [] })).toThrow();
  expect(() => TaskRepeatRule.parse({ kind: 'every_days', days: 0 })).toThrow();
});
