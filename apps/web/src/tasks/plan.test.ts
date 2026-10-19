import { expect, it } from 'vitest';
import type { TaskCard } from './api.ts';
import { emptyDays, isOverdue, nextWeekday, overdueLabel, planDay } from './plan.ts';

it('D19a.5: просрочка по крайнему сроку активного дела, не по дню плана', () => {
  const card = { status: 'open', planOn: '2026-10-01', dueOn: null } as TaskCard;
  expect(isOverdue(card, '2026-10-18')).toBe(false);
  expect(isOverdue({ ...card, dueOn: CalendarDate.parse('2026-10-17') }, '2026-10-18')).toBe(true);
  expect(isOverdue({ ...card, dueOn: CalendarDate.parse('2026-10-18') }, '2026-10-18')).toBe(false);
  expect(
    isOverdue({ ...card, status: 'done', dueOn: CalendarDate.parse('2026-10-17') }, '2026-10-18'),
  ).toBe(false);
});

it('TASK-12: следующая суббота и понедельник всегда в будущем, включая границы года', () => {
  expect(nextWeekday('2026-10-17', 6)).toBe('2026-10-24');
  expect(nextWeekday('2026-10-19', 1)).toBe('2026-10-26');
  expect(nextWeekday('2026-12-31', 1)).toBe('2027-01-04');
});
it('TASK-5: подписи дней, пустых промежутков и формы просрочки', () => {
  expect(planDay('2026-10-15', '2026-10-15')).toBe('Сегодня');
  expect(planDay('2026-10-16', '2026-10-15')).toBe('Завтра');
  expect(planDay('2026-10-19')).toBe('пн, 19 окт.');
  expect(emptyDays('2026-10-17', '2026-10-18')).toBe('сб 17 — вс 18 окт. · свободно');
  expect(emptyDays('2026-10-22', '2026-10-22')).toBe('чт 22 окт. · свободно');
  expect(overdueLabel(1)).toContain('1 просроченное дело');
  expect(overdueLabel(2)).toContain('2 просроченных дела');
  expect(overdueLabel(5)).toContain('5 просроченных дел');
});

import { CalendarDate } from '@homecrm/shared';
