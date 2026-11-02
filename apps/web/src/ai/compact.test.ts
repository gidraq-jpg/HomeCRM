import { describe, expect, it } from 'vitest';
import { draftSummary, needsReview, selectedCount } from './compact.ts';

describe('короткие черновики', () => {
  it('выбирает главные поля по типу', () => {
    expect(
      draftSummary('task', { date: { value: '2026-11-02' }, assigneeId: { value: null } }),
    ).toContain('нояб.');
    expect(draftSummary('shopping', { quantity: { value: '2 шт' } })).toBe('2 шт');
    expect(draftSummary('note', {}, 'Взрослые')).toBe('Взрослые');
    expect(draftSummary('meter', { meterId: { value: 'id' }, value: { value: '123' } })).toContain(
      '123',
    );
    expect(
      draftSummary('meter', { meterId: { value: 'id' }, values: { value: ['123.45', '67.89'] } }),
    ).toContain('123.45 / 67.89');
    expect(draftSummary('object', { objectType: { value: 'car' } })).toBe('Автомобиль');
  });
  it('находит неуверенность в полях, классификации и массивах', () => {
    expect(needsReview({ classification: { confident: false } })).toBe(true);
    expect(
      needsReview([
        { title: { value: 'a', confident: true } },
        { quantity: { value: null, confident: false } },
      ]),
    ).toBe(true);
    expect(needsReview({ title: { value: 'a', confident: true } })).toBe(false);
  });
  it('считает только отмеченные карточки', () => {
    expect(selectedCount([{ selected: true }, { selected: false }, { selected: true }])).toBe(2);
    expect(selectedCount([])).toBe(0);
  });
});
