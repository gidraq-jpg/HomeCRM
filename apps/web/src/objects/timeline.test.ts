import { describe, expect, it } from 'vitest';
import type { AutoEvent } from './api.ts';
import { todayIn } from './dates.ts';
import { describeAuto, ratingText, stars } from './timeline.ts';

const auto = (
  partial: Partial<AutoEvent> & Pick<AutoEvent, 'source' | 'operation'>,
): AutoEvent => ({
  id: 'e1',
  at: '2026-10-05T10:00:00.000000Z',
  actorId: 'a1',
  changes: {},
  ...partial,
});

describe('подписи автоматических событий ленты', () => {
  it('создание и изменение ключевых полей объекта', () => {
    expect(describeAuto(auto({ source: 'object', operation: 'create' }), null)).toBe(
      'Объект создан',
    );
    expect(
      describeAuto(
        auto({
          source: 'object',
          operation: 'update',
          changes: { title: { new: 'x' }, object_type: { new: 'car' } },
        }),
        null,
      ),
    ).toBe('Изменено: название, тип');
    expect(describeAuto(auto({ source: 'object', operation: 'update' }), null)).toBe(
      'Объект изменён',
    );
  });

  it('свои поля: создание и содержательные изменения, значения не показываются', () => {
    expect(describeAuto(auto({ source: 'field', operation: 'create' }), 'Площадь')).toBe(
      'Добавлено поле «Площадь»',
    );
    expect(describeAuto(auto({ source: 'field', operation: 'create' }), null)).toBe(
      'Добавлено своё поле',
    );
    const text = describeAuto(
      auto({ source: 'field', operation: 'update', changes: { value: { old: '1', new: '2' } } }),
      'Площадь',
    );
    expect(text).toBe('Поле «Площадь»: изменено — значение');
    expect(text).not.toContain('2');
  });
});

describe('оценка и дата', () => {
  it('оценка словами и звёздами', () => {
    expect(ratingText(4)).toBe('Оценка: 4 из 5');
    expect(stars(4)).toHaveLength(5);
  });

  it('сегодняшняя дата считается в часовом поясе дома', () => {
    const lateEvening = new Date('2026-10-05T22:30:00Z');
    expect(todayIn('Asia/Yekaterinburg', lateEvening)).toBe('2026-10-06');
    expect(todayIn('Europe/Moscow', lateEvening)).toBe('2026-10-06');
    expect(todayIn('UTC', lateEvening)).toBe('2026-10-05');
  });
});
