import { DOCUMENT_TYPES, DocumentData, type DocumentType } from '@homecrm/shared';
import {
  MAX_ISSUED_BY,
  MAX_NOTE,
  MAX_NUMBER,
  MAX_SERIES,
  MAX_TAG,
  MAX_TAGS,
  MAX_TITLE,
  MAX_WARNINGS,
} from './api.ts';

// Черновик документа: все поля — строки, как в форме. В памяти страницы он живёт, пока форма открыта;
// в адрес, журнал и localStorage не попадает.

export interface DocumentDraft {
  title: string;
  type: DocumentType;
  series: string;
  number: string;
  issuedBy: string;
  issuedOn: string;
  expiresOn: string;
  indefinite: boolean;
  note: string;
  /** Теги через запятую. */
  tags: string;
  /** Предупреждения в днях через запятую; пусто — значения по умолчанию для типа. */
  warnings: string;
  /** «Не предупреждать»: в документ уходит пустой список, а не значения типа (DOC-3). */
  noWarnings: boolean;
}

export const EMPTY_DOCUMENT: DocumentDraft = {
  title: '',
  type: 'other',
  series: '',
  number: '',
  issuedBy: '',
  issuedOn: '',
  expiresOn: '',
  indefinite: false,
  note: '',
  tags: '',
  warnings: '',
  noWarnings: false,
};

export function draftFrom(title: string, data: DocumentData): DocumentDraft {
  return {
    title,
    type: data.type,
    series: data.series,
    number: data.number,
    issuedBy: data.issuedBy,
    issuedOn: data.issuedOn ?? '',
    expiresOn: data.expiresOn ?? '',
    indefinite: data.indefinite,
    note: data.note,
    tags: data.tags.join(', '),
    warnings: (data.warnings ?? []).join(', '),
    noWarnings: data.warnings !== undefined && data.warnings.length === 0,
  };
}

export type DocumentField =
  | 'title'
  | 'series'
  | 'number'
  | 'issuedBy'
  | 'issuedOn'
  | 'expiresOn'
  | 'note'
  | 'tags'
  | 'warnings';

export type DocumentErrors = Partial<Record<DocumentField, string>>;

/** Теги из строки «паспорт, срочно»: без пустых и повторов, регистр сохраняется. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of input.split(/[,\n;]/)) {
    const tag = part.trim();
    if (tag === '' || seen.has(tag.toLocaleLowerCase('ru'))) continue;
    seen.add(tag.toLocaleLowerCase('ru'));
    tags.push(tag);
  }
  return tags;
}

/** Дни предупреждений из строки «180, 90 30»: целые 0…365, по убыванию, без повторов. `null` — не число. */
export function parseWarnings(input: string): number[] | null {
  const parts = input
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  const days: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 365) return null;
    if (!days.includes(value)) days.push(value);
  }
  return days.sort((a, b) => b - a);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DocumentResult =
  | { ok: true; title: string; data: DocumentData }
  | { ok: false; errors: DocumentErrors };

/** Черновик → данные для API; ошибки привязаны к полям, чтобы показать их рядом с ними. */
export function toDocument(draft: DocumentDraft): DocumentResult {
  const errors: DocumentErrors = {};
  const title = draft.title.trim();
  if (title === '') errors.title = 'Введите название: без него документ не сохранить.';
  else if (title.length > MAX_TITLE) errors.title = `Название не длиннее ${MAX_TITLE} знаков.`;
  if (draft.series.trim().length > MAX_SERIES)
    errors.series = `Серия не длиннее ${MAX_SERIES} знаков.`;
  if (draft.number.trim().length > MAX_NUMBER)
    errors.number = `Номер не длиннее ${MAX_NUMBER} знаков.`;
  if (draft.issuedBy.trim().length > MAX_ISSUED_BY) {
    errors.issuedBy = `Не длиннее ${MAX_ISSUED_BY} знаков.`;
  }
  if (draft.note.length > MAX_NOTE) errors.note = `Заметка не длиннее ${MAX_NOTE} знаков.`;
  if (draft.issuedOn !== '' && !DATE.test(draft.issuedOn)) {
    errors.issuedOn = 'Введите дату полностью: день, месяц и год.';
  }
  const expires = draft.indefinite ? '' : draft.expiresOn;
  if (expires !== '' && !DATE.test(expires)) {
    errors.expiresOn = 'Введите дату полностью: день, месяц и год.';
  }
  if (!errors.issuedOn && !errors.expiresOn && draft.issuedOn !== '' && expires !== '') {
    if (expires < draft.issuedOn)
      errors.expiresOn = 'Срок действия не может быть раньше даты выдачи.';
  }
  const tags = parseTags(draft.tags);
  if (tags.length > MAX_TAGS) errors.tags = `Тегов не больше ${MAX_TAGS}.`;
  else if (tags.some((tag) => tag.length > MAX_TAG)) {
    errors.tags = `Тег не длиннее ${MAX_TAG} знаков.`;
  }
  const warnings = draft.noWarnings ? [] : parseWarnings(draft.warnings);
  if (warnings === null) {
    errors.warnings = 'Введите дни числами от 0 до 365 через запятую, например: 180, 90, 30.';
  } else if (warnings.length > MAX_WARNINGS) {
    errors.warnings = `Предупреждений не больше ${MAX_WARNINGS}.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const parsed = DocumentData.safeParse({
    type: DOCUMENT_TYPES.includes(draft.type) ? draft.type : 'other',
    series: draft.series.trim(),
    number: draft.number.trim(),
    issuedBy: draft.issuedBy.trim(),
    issuedOn: draft.issuedOn === '' ? null : draft.issuedOn,
    expiresOn: expires === '' ? null : expires,
    indefinite: draft.indefinite,
    note: draft.note,
    tags,
    ...(draft.noWarnings
      ? { warnings: [] }
      : warnings !== null && warnings.length > 0
        ? { warnings }
        : {}),
  });
  if (!parsed.success) {
    // Общая схема строже полей формы (например, несуществующая дата 2026-02-31).
    return { ok: false, errors: { expiresOn: 'Проверьте даты: такой даты нет в календаре.' } };
  }
  return { ok: true, title, data: parsed.data };
}

/** Поле, с которого начинается список ошибок: на нём оказывается фокус. */
export const FIELD_ORDER: readonly DocumentField[] = [
  'title',
  'series',
  'number',
  'issuedBy',
  'issuedOn',
  'expiresOn',
  'tags',
  'warnings',
  'note',
];

export function firstError(errors: DocumentErrors): DocumentField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

/** Черновик новой версии: реквизиты прежние, а выдача и срок очищены — их вводят заново. */
export function renewalDraft(title: string, data: DocumentData): DocumentDraft {
  return { ...draftFrom(title, data), issuedOn: '', expiresOn: '' };
}
