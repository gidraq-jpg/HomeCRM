import { shiftTaskDate } from '@homecrm/shared';
import type { TaskCard } from './api.ts';

export function isOverdue(card: TaskCard, today: string): boolean {
  return ['open', 'waiting'].includes(card.status) && !!card.dueOn && card.dueOn < today;
}

export function planDay(date: string, today?: string) {
  if (date === today) return 'Сегодня';
  if (today && date === shiftTaskDate(today, 1)) return 'Завтра';
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
export function emptyDays(from: string, to: string) {
  const format = (date: string, month: boolean) =>
    new Intl.DateTimeFormat('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      ...(month ? { month: 'short' as const } : {}),
      timeZone: 'UTC',
    })
      .format(new Date(`${date}T12:00:00Z`))
      .replace(',', '');
  return `${from === to ? format(from, true) : `${format(from, from.slice(0, 7) !== to.slice(0, 7))} — ${format(to, true)}`} · свободно`;
}
export function nextWeekday(today: string, weekday: number) {
  const current = new Date(`${today}T12:00:00Z`).getUTCDay();
  return shiftTaskDate(today, (weekday - current + 7) % 7 || 7);
}
export function overdueLabel(count: number) {
  const form = new Intl.PluralRules('ru').select(count);
  return `${count} ${form === 'one' ? 'просроченное дело' : form === 'few' ? 'просроченных дела' : 'просроченных дел'} — в «Сегодня»`;
}
