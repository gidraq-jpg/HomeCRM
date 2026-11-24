import {
  DOCUMENT_LABELS,
  type DocumentType,
  type InboxDraft,
  type ShoppingDraft,
} from '@homecrm/shared';
import type { Visibility } from '../access/visibility.ts';
import { type DateOnly, formatFullDate, formatRub } from '../ui/format.ts';

/** Поле черновика в том виде, в каком его показывает разбор входящего. */
export type ReviewField = { key: string; label: string; value: string; confident: boolean };

const labels: Record<string, string> = {
  title: 'Название',
  body: 'Текст',
  date: 'Дата',
  time: 'Время',
  quantity: 'Количество',
  type: 'Тип',
  issuedOn: 'Выдан',
  expiresOn: 'Действует до',
  ownerId: 'Владелец',
  objectId: 'Объект',
  assigneeId: 'Ответственный',
  accountId: 'Лицевой счёт',
  totalCents: 'Сумма',
  period: 'Период',
  dueOn: 'Оплатить до',
  supplier: 'Поставщик',
  personId: 'Человек',
  meterId: 'Счётчик',
};
const DATE_KEYS = ['date', 'issuedOn', 'expiresOn', 'dueOn'];

/** Поля черновика для краткого показа: суммы в рублях, даты словами, тип документа по-русски. */
export function fieldsOf(fields: InboxDraft['fields'] | ShoppingDraft): ReviewField[] {
  if (Array.isArray(fields))
    return fields.flatMap((entry, index) =>
      fieldsOf(entry).map((field) => ({ ...field, key: `${index}:${field.key}` })),
    );
  return Object.entries(fields).flatMap(([key, field]) => {
    if (field && typeof field === 'object' && 'value' in field)
      return [
        {
          key,
          label: labels[key] ?? key,
          value:
            key === 'totalCents' && typeof field.value === 'number'
              ? formatRub(field.value)
              : DATE_KEYS.includes(key) &&
                  typeof field.value === 'string' &&
                  /^\d{4}-\d{2}-\d{2}$/.test(field.value)
                ? formatFullDate(field.value as DateOnly)
                : key === 'type' &&
                    typeof field.value === 'string' &&
                    field.value in DOCUMENT_LABELS
                  ? DOCUMENT_LABELS[field.value as DocumentType]
                  : String(field.value ?? 'Не указано'),
          confident: field.confident,
        },
      ];
    if (Array.isArray(field))
      return field.map((f, i) =>
        'name' in f
          ? {
              key: `${key}-${i}`,
              label: f.name,
              value: f.value.value,
              confident: f.value.confident,
            }
          : {
              key: `${key}-${i}`,
              label: `Зона ${i + 1}`,
              value: f.value ?? 'Не указано',
              confident: f.confident,
            },
      );
    return [];
  });
}

/** Поля для правки: путь через точку до каждого значения с отметкой уверенности. */
export function editableFields(value: unknown, prefix = ''): ReviewField[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, field]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (field && typeof field === 'object' && 'value' in field && 'confident' in field)
      return [
        {
          key: path,
          label: labels[key] ?? key,
          value: String(field.value ?? ''),
          confident: !!field.confident,
        },
      ];
    return editableFields(field, path);
  });
}

/** Тип поля ввода для правки значения черновика. */
export function inputTypeOf(key: string): 'date' | 'time' | 'text' {
  return DATE_KEYS.includes(key) ? 'date' : key === 'time' ? 'time' : 'text';
}

type Entry = Pick<InboxDraft, 'classification' | 'fields'>;

/**
 * Запись черновика после правки одного поля; `undefined`, если такого поля нет.
 * Исправленное поле считается проверенным, а объект попадает и в классификацию.
 */
export function withFieldChange<T extends Entry>(
  entry: T,
  key: string,
  value: string,
): T | undefined {
  const fields = structuredClone(entry.fields);
  let target: unknown = fields;
  const path = key.split('.');
  const leaf = path.pop();
  for (const part of path) target = (target as Record<string, unknown>)[part];
  if (!leaf || !target || typeof target !== 'object') return undefined;
  const old = (target as Record<string, { value: unknown }>)[leaf];
  if (!old) return undefined;
  (target as Record<string, unknown>)[leaf] = {
    ...old,
    value:
      typeof old.value === 'number'
        ? Number(value)
        : value || (['title', 'body'].includes(leaf) ? '' : null),
    confident: true,
  };
  return {
    ...entry,
    fields,
    classification:
      key === 'objectId'
        ? { ...entry.classification, objectId: { value: value || null, confident: true } }
        : entry.classification,
  } as T;
}

/** Подпись места новой записи в кратком черновике. */
export function placeLabel(place: Visibility | undefined): string {
  return place === 'household' ? 'Семья' : place === 'adults' ? 'Взрослые' : 'Только я';
}

/** Вид записи для правил создания по виду черновика. */
export function recordTypeOf(
  kind: InboxDraft['classification']['kind'],
): 'shopping_item' | 'document' | 'task' | 'note' {
  return kind === 'shopping'
    ? 'shopping_item'
    : kind === 'document' || kind === 'medical'
      ? 'document'
      : kind === 'task'
        ? 'task'
        : 'note';
}

const ATTACHED_LABELS: Record<string, string> = {
  task: 'к делу',
  note: 'к заметке',
  document: 'к документу',
  object: 'к объекту',
  meter_reading: 'к показанию',
  utility_charge: 'к начислению',
};

/** Сообщение после разбора: куда ушёл исходный файл или что он удалён. */
export function attachmentMessage(fileCount: number, attachedTo: readonly string[] | undefined) {
  return fileCount
    ? attachedTo?.length
      ? `Исходный файл прикреплён ${attachedTo.map((type) => ATTACHED_LABELS[type]).join(' и ')}.`
      : 'Исходный файл удалён.'
    : '';
}
