import { describe, expect, it } from 'vitest';
import { ApiError } from '../auth/api.ts';
import {
  budgetText,
  clockText,
  KIND_HINTS,
  kindLabel,
  notificationError,
  quietHoursText,
  resultInfo,
  UTILITY_KINDS,
} from './labels.ts';
import { PushError } from './push.ts';

describe('тексты уведомлений', () => {
  it('время без нуля впереди и тире между ним', () => {
    expect(clockText('08:00')).toBe('8:00');
    expect(quietHoursText('22:00', '08:00')).toBe(`22:00${String.fromCodePoint(0x2013)}8:00`);
    expect(quietHoursText('09:30', '09:30')).toBe('Тихие часы выключены');
  });

  it('бюджет — в нужной форме слова', () => {
    expect(budgetText(0)).toBe('0 уведомлений в день');
    expect(budgetText(1)).toBe('1 уведомление в день');
    expect(budgetText(3)).toBe('3 уведомления в день');
    expect(budgetText(5)).toBe('5 уведомлений в день');
    expect(budgetText(21)).toBe('21 уведомление в день');
    expect(budgetText(100)).toBe('100 уведомлений в день');
  });

  it('вид и итог попытки: статус словами, код только у ошибок', () => {
    expect(kindLabel('deadline')).toBe('Сроки записей');
    expect(kindLabel('summary')).toBe('Другое');
    expect(resultInfo('sent', null)).toEqual({ text: 'Принято службой push', tone: 'ok' });
    expect(resultInfo('retry', 503).text).toBe('Ошибка, повторим (код 503)');
    expect(resultInfo('gone', 410).tone).toBe('danger');
    expect(resultInfo('uncertain', null).tone).toBe('warning');
    expect(resultInfo('что-то новое', null).tone).toBe('neutral');
  });

  it('ошибки: понятные тексты без технических подробностей', () => {
    expect(notificationError(new PushError('denied'), 'enable')).toContain('запрещены');
    expect(notificationError(new PushError('unsupported'), 'enable')).toContain('не умеет');
    expect(notificationError(new ApiError(503, 'PUSH_NOT_CONFIGURED'), 'enable')).toContain(
      'не настроен',
    );
    expect(notificationError(new ApiError(400, 'INVALID_SETTINGS'), 'save')).toContain(
      'от 0 до 100',
    );
    expect(notificationError(new ApiError(403, 'HOUSE_REQUIRED'), 'enable')).toContain('дома');
    expect(notificationError(new ApiError(404, 'NOT_FOUND'), 'remove')).toContain('нет в списке');
    expect(notificationError(new ApiError(500, 'X'), 'load')).toContain('Не удалось загрузить');
  });
});

describe('виды коммунальных уведомлений (UTIL-13)', () => {
  it('у каждого вида своя подпись и подсказка', () => {
    const kinds = [
      'readings_open',
      'readings_closing',
      'readings_last_day',
      'payment_upcoming',
      'payment_due',
      'verification',
    ];
    expect(kinds.map(kindLabel)).toEqual([
      'Открылось окно показаний',
      'Окно закрывается завтра',
      'Последний день окна',
      'Оплата через 3 дня',
      'Оплата сегодня',
      'Подходит срок поверки',
    ]);
    for (const kind of kinds) expect(KIND_HINTS[kind]).toBeTruthy();
    expect(UTILITY_KINDS).toEqual(kinds);
  });
});
