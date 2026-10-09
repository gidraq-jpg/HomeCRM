import {
  DOCUMENT_LABELS,
  DOCUMENT_TYPES,
  type DocumentData,
  type DocumentType,
} from '@homecrm/shared';
import {
  addDays,
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

/** Правило срока из ответа сервера: нужны только вид, начало окна, его длина и ожидание даты рождения. */
export interface ExpiryRuleLike {
  kind: string;
  date?: string | undefined;
  durationDays?: number | undefined;
  eventDate?: string | null | undefined;
}

/** Поля документа, от которых зависит срок. */
export interface ExpiryData {
  expiresOn: string | null;
  indefinite: boolean;
  type?: DocumentType | undefined;
  issuedOn?: string | null | undefined;
}

/** Откуда взят срок документа (DOC-4): явная дата важнее вычисленной по возрасту. */
export type ExpirySource =
  | { kind: 'explicit'; until: DateOnly }
  | { kind: 'indefinite' }
  | {
      kind: 'age';
      /** Начало окна замены (день рождения, на который приходится граница) и его конец. */
      start: DateOnly;
      until: DateOnly;
      /** 20 или 45, если это видно по дате выдачи; иначе неизвестно. */
      years: 20 | 45 | null;
    }
  | { kind: 'pending' }
  | { kind: 'none' };

/** Сколько лет, по дате выдачи, остаётся до границы: до 7 лет — первая замена (20), от 20 — вторая (45). */
function passportYears(issuedOn: string | null, start: DateOnly): 20 | 45 | null {
  if (issuedOn === null) return null;
  const years = daysBetween(issuedOn as DateOnly, start) / 365.25;
  if (years <= 7) return 20;
  return years >= 20 ? 45 : null;
}

/**
 * Откуда взят срок. Паспорт РФ без явной даты получает от сервера окно замены по возрасту (`window`)
 * либо ожидание даты рождения владельца (`after` без даты события). Дату рождения сервер не отдаёт.
 */
export function expirySource(
  data: ExpiryData,
  rule: ExpiryRuleLike | null | undefined,
): ExpirySource {
  if (data.indefinite) return { kind: 'indefinite' };
  if (data.expiresOn !== null) return { kind: 'explicit', until: data.expiresOn as DateOnly };
  if (data.type === 'russian_passport' && rule) {
    if (rule.kind === 'window' && rule.date !== undefined) {
      const start = rule.date as DateOnly;
      return {
        kind: 'age',
        start,
        until: addDays(start, rule.durationDays ?? 0),
        years: passportYears(data.issuedOn ?? null, start),
      };
    }
    if (rule.kind === 'after' && (rule.eventDate === null || rule.eventDate === undefined)) {
      return { kind: 'pending' };
    }
  }
  return { kind: 'none' };
}

/**
 * Срок документа на сегодня в часовом поясе дома. Недействительная версия срока не показывает:
 * её срок снят вместе с версией (ADR-0035). Статус всегда с текстом, не только цвет.
 * Срок паспорта по возрасту считается от конца окна замены; без даты рождения он «вычисляется».
 */
export function expiryInfo(
  data: ExpiryData,
  valid: boolean,
  today: DateOnly,
  rule?: ExpiryRuleLike | null,
): ExpiryInfo {
  if (!valid) return { tone: 'neutral', label: 'Недействителен', until: 'недействителен' };
  const source = expirySource(data, rule);
  if (source.kind === 'indefinite') {
    return { tone: 'neutral', label: 'Бессрочно', until: 'бессрочно' };
  }
  if (source.kind === 'pending') {
    return {
      tone: 'neutral',
      label: 'Срок вычислится по дате рождения',
      until: 'срок вычислится по дате рождения',
    };
  }
  if (source.kind === 'none') {
    return { tone: 'neutral', label: 'Срок не указан', until: 'срок не указан' };
  }
  const end = source.until;
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
