import { describe, expect, it } from 'vitest';
import {
  attachmentMessage,
  editableFields,
  fieldsOf,
  inputTypeOf,
  placeLabel,
  recordTypeOf,
  withFieldChange,
} from './review-fields.ts';

const field = <T>(value: T, confident = true) => ({ value, confident });

describe('fieldsOf', () => {
  it('показывает сумму в рублях, дату словами и тип документа по-русски', () => {
    const shown = fieldsOf({
      totalCents: field(123_45),
      dueOn: field('2026-10-05'),
      type: field('russian_passport'),
      title: field(null, false),
    } as never);
    expect(shown.map((f) => f.label)).toEqual(['Сумма', 'Оплатить до', 'Тип', 'Название']);
    expect(shown[0]?.value).toMatch(/123,45/);
    expect(shown[1]?.value).toMatch(/2026/);
    expect(shown[1]?.value).not.toBe('2026-10-05');
    expect(shown[2]?.value).toBe('Паспорт РФ');
    expect(shown[3]).toMatchObject({ value: 'Не указано', confident: false });
  });

  it('нумерует позиции списка и разворачивает поля документа и зоны', () => {
    expect(
      fieldsOf([{ title: field('Молоко') }, { title: field('Хлеб') }] as never).map((f) => f.key),
    ).toEqual(['0:title', '1:title']);
    const shown = fieldsOf({
      fields: [{ name: 'Серия', value: field('12 34') }],
      zones: [field(null, false)],
    } as never);
    expect(shown).toEqual([
      { key: 'fields-0', label: 'Серия', value: '12 34', confident: true },
      { key: 'zones-0', label: 'Зона 1', value: 'Не указано', confident: false },
    ]);
  });
});

describe('editableFields', () => {
  it('даёт путь через точку до вложенных значений', () => {
    expect(
      editableFields({ title: field('Счёт'), nested: { objectId: field(null, false) } }),
    ).toEqual([
      { key: 'title', label: 'Название', value: 'Счёт', confident: true },
      { key: 'nested.objectId', label: 'Объект', value: '', confident: false },
    ]);
    expect(editableFields(null)).toEqual([]);
  });
});

describe('withFieldChange', () => {
  const entry = {
    classification: { kind: 'task', objectId: field(null, false) },
    fields: { title: field('Старое', false), count: field(1), nested: { date: field('x') } },
  } as never;

  it('меняет значение, отмечает его проверенным и не трогает исходное', () => {
    const next = withFieldChange(entry, 'title', '') as never as {
      fields: { title: { value: string; confident: boolean } };
    };
    expect(next.fields.title).toEqual({ value: '', confident: true });
    expect((entry as { fields: { title: { value: string } } }).fields.title.value).toBe('Старое');
  });

  it('приводит числа, пустое делает null и переносит объект в классификацию', () => {
    const count = withFieldChange(entry, 'count', '5') as never as {
      fields: { count: { value: number } };
    };
    expect(count.fields.count.value).toBe(5);
    const nested = withFieldChange(entry, 'nested.date', '') as never as {
      fields: { nested: { date: { value: unknown } } };
    };
    expect(nested.fields.nested.date.value).toBeNull();
    expect(withFieldChange(entry, 'missing', 'a')).toBeUndefined();
  });

  it('объект из правки попадает в классификацию', () => {
    const withObject = {
      classification: { kind: 'task', objectId: field(null, false) },
      fields: { objectId: field(null, false) },
    } as never;
    const next = withFieldChange(withObject, 'objectId', 'o1') as never as {
      classification: { objectId: unknown };
    };
    expect(next.classification.objectId).toEqual({ value: 'o1', confident: true });
  });
});

describe('подписи', () => {
  it('место, вид записи и тип поля ввода', () => {
    expect([placeLabel('household'), placeLabel('adults'), placeLabel(undefined)]).toEqual([
      'Семья',
      'Взрослые',
      'Только я',
    ]);
    expect(
      (['shopping', 'document', 'medical', 'task', 'note'] as const).map(recordTypeOf),
    ).toEqual(['shopping_item', 'document', 'document', 'task', 'note']);
    expect(['dueOn', 'time', 'title'].map(inputTypeOf)).toEqual(['date', 'time', 'text']);
  });

  it('сообщение о судьбе исходного файла', () => {
    expect(attachmentMessage(0, ['task'])).toBe('');
    expect(attachmentMessage(1, [])).toBe('Исходный файл удалён.');
    expect(attachmentMessage(2, ['task', 'document'])).toBe(
      'Исходный файл прикреплён к делу и к документу.',
    );
  });
});
