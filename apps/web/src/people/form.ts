import { PERSON_CATEGORIES, PersonData } from '@homecrm/shared';
import * as z from 'zod';
import type { PhoneDraft } from '../organizations/form.ts';
import { parseLink } from '../ui/link.ts';
import {
  MAX_EMAIL,
  MAX_LABEL,
  MAX_NOTE,
  MAX_TEXT,
  MAX_TITLE,
  type PersonCategory,
  type PersonInput,
} from './api.ts';
import type { PersonCard } from './schema.ts';

// Форма человека (CONT-1): чистые функции без React. ФИО обязательно, остальное нет. Всё введённое
// живёт только в памяти страницы.

export interface MessengerDraft {
  key: string;
  label: string;
  url: string;
}

export interface EmailDraft {
  key: string;
  value: string;
}

export interface PersonDraft {
  title: string;
  categories: PersonCategory[];
  phones: PhoneDraft[];
  emails: EmailDraft[];
  messengers: MessengerDraft[];
  address: string;
  /** Дата из поля даты: `YYYY-MM-DD`; пусто — дня рождения нет. */
  birthday: string;
  /** Год неизвестен: сохраняется `--MM-DD`. */
  birthdayNoYear: boolean;
  organizationId: string;
  note: string;
}

let counter = 0;
export function nextKey(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export function emptyPersonDraft(categories: PersonCategory[] = []): PersonDraft {
  return {
    title: '',
    categories,
    phones: [],
    emails: [],
    messengers: [],
    address: '',
    birthday: '',
    birthdayNoYear: false,
    organizationId: '',
    note: '',
  };
}

export function personDraft(
  card: Pick<PersonCard, 'title' | 'data' | 'organizationId'>,
): PersonDraft {
  const { data } = card;
  const noYear = data.birthday?.startsWith('--') ?? false;
  return {
    title: card.title,
    categories: [...data.categories],
    phones: data.phones.map((phone) => ({ key: nextKey('phone'), ...phone })),
    emails: data.emails.map((value) => ({ key: nextKey('email'), value })),
    messengers: data.messengers.map((item) => ({ key: nextKey('messenger'), ...item })),
    address: data.address,
    // Для поля даты нужен високосный год: 29 февраля без года остаётся возможным.
    birthday:
      data.birthday === null ? '' : noYear ? `2000${data.birthday.slice(1)}` : data.birthday,
    birthdayNoYear: noYear,
    organizationId: card.organizationId ?? '',
    note: data.note,
  };
}

export function toggleCategory(
  categories: readonly PersonCategory[],
  category: PersonCategory,
  on: boolean,
): PersonCategory[] {
  const rest = categories.filter((item) => item !== category);
  // Порядок категорий — как в справочнике, а не как нажимали.
  return on ? PERSON_CATEGORIES.filter((item) => item === category || rest.includes(item)) : rest;
}

export interface PersonErrors {
  title?: string;
  address?: string;
  birthday?: string;
  note?: string;
  phones: Record<string, string>;
  emails: Record<string, string>;
  messengers: Record<string, string>;
}

export type PersonResult = { ok: true; value: PersonInput } | { ok: false; errors: PersonErrors };

const EMAIL = z.email().max(MAX_EMAIL);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Данные для сохранения. Совсем пустые строки пропускаются, ссылки мессенджеров нормализуются. */
export function toPersonInput(draft: PersonDraft): PersonResult {
  const errors: PersonErrors = { phones: {}, emails: {}, messengers: {} };
  const title = draft.title.trim();
  if (title === '') errors.title = 'Введите ФИО: без него человека не сохранить.';
  else if (title.length > MAX_TITLE)
    errors.title = `ФИО длиннее ${MAX_TITLE} знаков. Сократите его.`;

  const address = draft.address.trim();
  if (address.length > MAX_TEXT) errors.address = `Адрес длиннее ${MAX_TEXT} знаков.`;
  if (draft.note.length > MAX_NOTE) errors.note = `Заметка длиннее ${MAX_NOTE} знаков.`;

  let birthday: string | null = null;
  if (draft.birthday !== '') {
    if (!DATE.test(draft.birthday) || Number.isNaN(Date.parse(draft.birthday))) {
      errors.birthday = 'Введите дату полностью: день, месяц и год.';
    } else {
      birthday = draft.birthdayNoYear ? `--${draft.birthday.slice(5)}` : draft.birthday;
    }
  }

  const phones: PersonInput['data']['phones'] = [];
  for (const phone of draft.phones) {
    const number = phone.number.trim();
    const label = phone.label.trim();
    if (number === '' && label === '' && !phone.emergency) continue;
    if (number === '') errors.phones[phone.key] = 'Укажите номер или очистите строку.';
    else if (number.length > 100) errors.phones[phone.key] = 'Номер длиннее 100 знаков.';
    else if (label.length > MAX_LABEL)
      errors.phones[phone.key] = `Подпись длиннее ${MAX_LABEL} знаков.`;
    else phones.push({ number, label, emergency: phone.emergency });
  }

  const emails: string[] = [];
  for (const email of draft.emails) {
    const value = email.value.trim();
    if (value === '') continue;
    if (!EMAIL.safeParse(value).success)
      errors.emails[email.key] = 'Адрес почты выглядит так: name@example.ru.';
    else emails.push(value);
  }

  const messengers: PersonInput['data']['messengers'] = [];
  for (const item of draft.messengers) {
    const label = item.label.trim();
    if (item.url.trim() === '' && label === '') continue;
    const link = parseLink(item.url);
    if (!link.ok || link.url === null)
      errors.messengers[item.key] =
        'Ссылка на мессенджер начинается с http:// или https://, например t.me/name.';
    else if (label.length > MAX_LABEL)
      errors.messengers[item.key] = `Подпись длиннее ${MAX_LABEL} знаков.`;
    else messengers.push({ label, url: link.url });
  }

  const failed =
    errors.title !== undefined ||
    errors.address !== undefined ||
    errors.birthday !== undefined ||
    errors.note !== undefined ||
    Object.keys(errors.phones).length > 0 ||
    Object.keys(errors.emails).length > 0 ||
    Object.keys(errors.messengers).length > 0;
  if (failed) return { ok: false, errors };

  const parsed = PersonData.safeParse({
    categories: draft.categories,
    phones,
    emails,
    messengers,
    address,
    birthday,
    note: draft.note,
  });
  if (!parsed.success) {
    // Общая схема строже полей формы (например, несуществующая дата).
    return {
      ok: false,
      errors: { ...errors, birthday: 'Проверьте дату: такой даты нет в календаре.' },
    };
  }
  return {
    ok: true,
    value: {
      title,
      data: parsed.data,
      organizationId: draft.organizationId === '' ? null : draft.organizationId,
    },
  };
}
