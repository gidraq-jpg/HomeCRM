import { describe, expect, it } from 'vitest';
import type { ObjectField } from './api.ts';
import { addField, fromCard, removeField, toInput, updateField, withoutIds } from './fields.ts';

const field = (id: string, position: number, deletedAt: string | null = null): ObjectField => ({
  id,
  name: `Поле ${id}`,
  value: `Значение ${id}`,
  position,
  deletedAt,
});

describe('свои поля объекта', () => {
  it('из карточки берутся только действующие поля в порядке position', () => {
    const draft = fromCard([field('b', 2), field('a', 1), field('x', 0, '2026-10-05T10:00:00Z')]);
    expect(draft.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('совсем пустые строки пропускаются, названия обрезаются, id сохраняется', () => {
    const draft = [
      { key: 'k1', id: 'a', name: '  Площадь ', value: '54 м²' },
      { key: 'k2', name: '', value: '' },
      { key: 'k3', name: 'Этаж', value: '' },
    ];
    expect(toInput(draft)).toEqual({
      ok: true,
      fields: [
        { id: 'a', name: 'Площадь', value: '54 м²' },
        { name: 'Этаж', value: '' },
      ],
    });
  });

  it('значение без названия не сохраняется и называет строку', () => {
    expect(toInput([{ key: 'k9', name: ' ', value: 'что-то' }])).toEqual({ ok: false, key: 'k9' });
  });

  it('добавление, правка и удаление; больше 50 полей нельзя', () => {
    let draft = addField([]);
    expect(draft).toHaveLength(1);
    const key = draft[0]?.key ?? '';
    draft = updateField(draft, key, { name: 'Мощность', value: '2 кВт' });
    expect(draft[0]).toMatchObject({ name: 'Мощность', value: '2 кВт' });
    draft = removeField(draft, key);
    expect(draft).toEqual([]);
    let many: ReturnType<typeof addField> = [];
    for (let i = 0; i < 60; i += 1) many = addField(many);
    expect(many).toHaveLength(50);
  });

  it('длинные название и значение обрезаются по пределам API', () => {
    const [created] = addField([]);
    const draft = updateField([created ?? { key: '', name: '', value: '' }], created?.key ?? '', {
      name: 'н'.repeat(150),
      value: 'з'.repeat(5000),
    });
    expect(draft[0]?.name).toHaveLength(100);
    expect(draft[0]?.value).toHaveLength(4000);
  });

  it('у копии id полей убираются', () => {
    expect(withoutIds([{ id: 'a', name: 'Этаж', value: '3' }])).toEqual([
      { name: 'Этаж', value: '3' },
    ]);
  });
});
