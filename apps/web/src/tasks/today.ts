import type { RadarItem } from '../deadlines/api.ts';
import type { TaskCard } from './api.ts';
import { uniqueTasks } from './queries.ts';

export function todayTaskCount(tasks: readonly Pick<TaskCard, 'id' | 'status'>[]) {
  return uniqueTasks([...tasks]).filter(
    (task) => task.status === 'open' || task.status === 'waiting',
  ).length;
}

export function nearbyDeadlineCount(items: readonly Pick<RadarItem, 'id' | 'group'>[]) {
  return uniqueTasks([...items]).filter((item) => ['overdue', 'now', '7days'].includes(item.group))
    .length;
}

/** Ошибка обновления и пересчёт не выдают прежнее число за актуальный итог. */
export function metricValue(
  count: number | undefined,
  error: unknown,
  { recalculating = false, partial = false } = {},
) {
  if (error) return { value: '—', status: 'Нет данных' };
  if (recalculating) return { value: '—', status: 'Пересчёт…' };
  if (count === undefined) return { value: '—', status: 'Загружаем…' };
  return { value: `${count}${partial ? '+' : ''}`, status: '' };
}
