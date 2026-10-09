import {
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  type DocumentData,
  type DocumentType,
} from '@homecrm/shared';
import {
  countWord,
  type DateOnly,
  daysBetween,
  formatFullDate,
  formatShortDate,
  plural,
} from '../ui/format.ts';
import type { StatusTone } from '../ui/Row.tsx';

// Тексты документов — PRD, раздел 13 и DOC-1…7: названия типов, сроки словами, правильные формы числа.

export const documentCount = (count: number) =>
  countWord(count, ['документ', 'документа', 'документов']);

export const versionCount = (count: number) => countWord(count, ['версия', 'версии', 'версий']);

/** Группы типов — как в DOC-1; в списке выбора они идут под своими заголовками. */
export const DOCUMENT_TYPE_GROUPS: readonly { label: string; types: readonly DocumentType[] }[] = [
  {
    label: 'Удостоверения личности',
    types: [
      'russian_passport',
      'international_passport',
      'birth_certificate',
      'snils',
      'inn',
      'driver_license',
    ],
  },
  { label: 'Полисы', types: ['oms', 'dms', 'osago', 'kasko', 'property_insurance'] },
  { label: 'Автомобиль и недвижимость', types: ['sts', 'pts', 'egrn'] },
  {
    label: 'Прочие',
    types: ['contract', 'warranty_receipt', 'medical', 'school', 'certificate', 'other'],
  },
];

export const TYPE_OPTIONS = DOCUMENT_TYPES.map((value) => ({
  value,
  label: DOCUMENT_LABELS[value],
}));

export { DOCUMENT_LABELS };

/** Горизонт «истекает»: те же 90 дней, что в фильтре списка и радаре (DOC-7). */
export const EXPIRING_DAYS = 90;

const DAYS = ['день', 'дня', 'дней'] as const;

export interface ExpiryInfo {
  tone: StatusTone;
  /** Короткая подпись статуса: «Истекает через 23 дня», «Просрочен на 3 дня». */
  label: string;
  /** Срок словами для строки списка: «до 5 окт. 2030», «бессрочно». */
  until: string;
}

/**
 * Срок документа на сегодня в часовом поясе дома. Недействительная версия срока не показывает:
 * её срок снят вместе с версией (ADR-0035). Статус всегда с текстом, не только цвет.
 */
export function expiryInfo(
  data: { expiresOn: string | null; indefinite: boolean },
  valid: boolean,
  today: DateOnly,
): ExpiryInfo {
  if (!valid) return { tone: 'neutral', label: 'Недействителен', until: 'недействителен' };
  if (data.indefinite) return { tone: 'neutral', label: 'Бессрочно', until: 'бессрочно' };
  if (data.expiresOn === null) {
    return { tone: 'neutral', label: 'Срок не указан', until: 'срок не указан' };
  }
  const end = data.expiresOn as DateOnly;
  const until = `до ${formatShortDate(end, today)}`;
  const left = daysBetween(today, end);
  if (left < 0) {
    return { tone: 'danger', label: `Просрочен на ${-left} ${plural(-left, DAYS)}`, until };
  }
  if (left === 0) return { tone: 'warning', label: 'Истекает сегодня', until };
  if (left <= EXPIRING_DAYS) {
    return { tone: 'warning', label: `Истекает через ${left} ${plural(left, DAYS)}`, until };
  }
  return { tone: 'ok', label: `Действует ${until}`, until };
}

/** Дата для карточки: «5 окт. 2030» — год всегда, документ живёт годами. */
export function dateLabel(value: string | null): string {
  return value === null ? '—' : formatFullDate(value as DateOnly);
}

/** Серия и номер одной строкой — то, что копируется и показывается по кнопке «Показать». */
export function seriesAndNumber(data: Pick<DocumentData, 'series' | 'number'>): string {
  return [data.series, data.number].filter((part) => part !== '').join(' ');
}

/** Маска вместо серии и номера: длина не выдаётся. */
export const MASKED_NUMBER = '•••• ••••••';

/** Предупреждения словами: «за 180, 90 и 30 дней». Пусто — значения по умолчанию для типа. */
export function warningsLabel(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => b - a);
  if (sorted.length === 0) return 'по умолчанию для типа';
  const last = sorted[sorted.length - 1] ?? 0;
  const lead = sorted.slice(0, -1);
  const tail = last === 0 ? 'в день срока' : `${last} ${plural(last, DAYS)}`;
  if (lead.length === 0) return last === 0 ? tail : `за ${tail}`;
  return `за ${lead.join(', ')} и ${tail}`;
}
