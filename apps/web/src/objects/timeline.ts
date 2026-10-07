import type { AutoEvent } from './api.ts';

// Подписи автоматических событий ленты (OBJ-3): что изменилось, но не какими были значения.
// Названия и значения полей в историю попадают как есть, поэтому на экране показывается только
// перечень изменённого — так лента не дублирует то, что уже видно в карточке.

const OBJECT_CHANGES: Readonly<Record<string, string>> = {
  title: 'название',
  object_type: 'тип',
  type_data: 'поля типа',
  assignee_id: 'ответственный',
};

const FIELD_CHANGES: Readonly<Record<string, string>> = {
  title: 'название',
  value: 'значение',
  position: 'порядок',
};

function listOf(changes: AutoEvent['changes'], labels: Readonly<Record<string, string>>): string {
  const names = Object.keys(changes ?? {})
    .map((key) => labels[key])
    .filter((label): label is string => label !== undefined);
  return names.join(', ');
}

/** Одна строка о событии: «Объект создан», «Изменено: название, тип», «Поле «Площадь»: изменено значение». */
export function describeAuto(item: AutoEvent, fieldName: string | null): string {
  if (item.source === 'object') {
    if (item.operation === 'create') return 'Объект создан';
    const list = listOf(item.changes, OBJECT_CHANGES);
    return list === '' ? 'Объект изменён' : `Изменено: ${list}`;
  }
  const field = fieldName === null ? 'Своё поле' : `Поле «${fieldName}»`;
  if (item.operation === 'create') {
    return fieldName === null ? 'Добавлено своё поле' : `Добавлено поле «${fieldName}»`;
  }
  const list = listOf(item.changes, FIELD_CHANGES);
  return list === '' ? `${field}: изменено` : `${field}: изменено — ${list}`;
}

/** Оценка словами и звёздами: «Оценка: 4 из 5». Звёзды только для глаза, читалка слышит слова. */
export function ratingText(rating: number): string {
  return `Оценка: ${rating} из 5`;
}

export const STAR = String.fromCodePoint(0x2605);
export const STAR_EMPTY = String.fromCodePoint(0x2606);

export function stars(rating: number): string {
  return STAR.repeat(rating) + STAR_EMPTY.repeat(Math.max(0, 5 - rating));
}
