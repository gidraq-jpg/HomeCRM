import {
  type FieldInput,
  MAX_FIELD_NAME,
  MAX_FIELD_VALUE,
  MAX_FIELDS,
  type ObjectField,
} from './api.ts';

// Свои поля «название — значение» в форме: добавление, правка, удаление. Чистые функции без
// React, чтобы правила можно было проверить без браузера. Порядок — порядок в массиве API.

export interface DraftField {
  /** Ключ строки в форме: у нового поля ещё нет `id` от сервера. */
  key: string;
  id?: string;
  name: string;
  value: string;
}

let counter = 0;
export function nextKey(): string {
  counter += 1;
  return `field-${counter}`;
}

/** Действующие поля карточки в порядке `position`; удалённые не показываются. */
export function fromCard(fields: readonly ObjectField[]): DraftField[] {
  return fields
    .filter((field) => field.deletedAt === null)
    .toSorted((a, b) => a.position - b.position)
    .map((field) => ({ key: field.id, id: field.id, name: field.name, value: field.value }));
}

export type FieldsResult =
  | { ok: true; fields: FieldInput[] }
  /** Значение без названия: сервер такое поле не примет, а человеку нужно сказать, какое. */
  | { ok: false; key: string };

/** Поля для сохранения: совсем пустые строки пропускаются, названия обрезаются по краям. */
export function toInput(fields: readonly DraftField[]): FieldsResult {
  const result: FieldInput[] = [];
  for (const field of fields) {
    const name = field.name.trim();
    if (name === '' && field.value.trim() === '') continue;
    if (name === '') return { ok: false, key: field.key };
    result.push({ ...(field.id ? { id: field.id } : {}), name, value: field.value });
  }
  return { ok: true, fields: result };
}

export function addField(fields: readonly DraftField[]): DraftField[] {
  if (fields.length >= MAX_FIELDS) return [...fields];
  return [...fields, { key: nextKey(), name: '', value: '' }];
}

export function updateField(
  fields: readonly DraftField[],
  key: string,
  change: Partial<Pick<DraftField, 'name' | 'value'>>,
): DraftField[] {
  return fields.map((field) =>
    field.key === key
      ? {
          ...field,
          ...(change.name === undefined ? {} : { name: change.name.slice(0, MAX_FIELD_NAME) }),
          ...(change.value === undefined ? {} : { value: change.value.slice(0, MAX_FIELD_VALUE) }),
        }
      : field,
  );
}

export function removeField(fields: readonly DraftField[], key: string): DraftField[] {
  return fields.filter((field) => field.key !== key);
}

/** Поля копии: у новой записи `id` исходной сервер не принимает. */
export function withoutIds(fields: readonly FieldInput[]): FieldInput[] {
  return fields.map(({ name, value }) => ({ name, value }));
}
