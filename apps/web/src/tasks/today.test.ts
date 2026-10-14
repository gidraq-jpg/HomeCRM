import { describe, expect, it } from 'vitest';
import { metricValue, nearbyDeadlineCount, todayTaskCount } from './today.ts';

describe('показатели «Сегодня»', () => {
  it('учитывает только уникальные активные дела, включая ожидание', () => {
    expect(
      todayTaskCount([
        { id: 'main', status: 'open' },
        { id: 'main', status: 'open' },
        { id: 'overdue', status: 'waiting' },
        { id: 'done', status: 'done' },
        { id: 'cancelled', status: 'cancelled' },
        { id: 'closed', status: 'open' },
        { id: 'closed', status: 'done' },
      ]),
    ).toBe(2);
  });
  it('близкие сроки включают просрочку и неделю, но не дальние и не дубликаты', () => {
    expect(
      nearbyDeadlineCount([
        { id: '1', group: 'overdue' },
        { id: '2', group: 'now' },
        { id: '2', group: 'now' },
        { id: '3', group: '7days' },
        { id: '4', group: '30days' },
        { id: '5', group: '90days' },
        { id: '6', group: 'later' },
        { id: 'changed', group: 'now' },
        { id: 'changed', group: '30days' },
      ]),
    ).toBe(3);
  });
  it('отличает пустой успешный ответ от загрузки, ошибки обновления и пересчёта', () => {
    expect(metricValue(0, null)).toEqual({ value: '0', status: '' });
    expect(metricValue(undefined, null)).toEqual({ value: '—', status: 'Загружаем…' });
    expect(metricValue(0, new Error('Network failure'))).toEqual({
      value: '—',
      status: 'Нет данных',
    });
    expect(metricValue(0, null, { recalculating: true })).toEqual({
      value: '—',
      status: 'Пересчёт…',
    });
    expect(metricValue(100, null, { partial: true })).toEqual({ value: '100+', status: '' });
  });
});
