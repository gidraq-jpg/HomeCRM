import type { OrganizationData } from '@homecrm/shared';
import { parseLink } from '../ui/link.ts';
import {
  MAX_LABEL,
  MAX_NOTE,
  MAX_NUMBER,
  MAX_PHONES,
  MAX_TEXT,
  MAX_TITLE,
  type OrganizationType,
} from './api.ts';

// Форма организации (CONT-2): чистые функции без React. Название обязательно, остальное нет.

export const ORGANIZATION_TYPE_LABELS: Readonly<Record<OrganizationType, string>> = {
  management: 'УК или ТСЖ',
  utility: 'Ресурсоснабжающая организация',
  bank: 'Банк',
  insurance: 'Страховая',
  school: 'Школа',
  clinic: 'Поликлиника',
  service: 'Сервис',
  shop: 'Магазин',
  government: 'Госорган',
  other: 'Другое',
};

/** Подписи для телефонов, которые чаще всего нужны на бегу. */
export const PHONE_LABEL_HINTS = ['Диспетчер', 'Аварийная служба', 'Бухгалтерия'] as const;

export interface PhoneDraft {
  /** Ключ строки в форме: у нового телефона ещё нет ничего, кроме него. */
  key: string;
  number: string;
  label: string;
  emergency: boolean;
}

export interface OrganizationDraft {
  title: string;
  organizationType: OrganizationType;
  phones: PhoneDraft[];
  website: string;
  address: string;
  openingHours: string;
  note: string;
}

let counter = 0;
export function nextPhoneKey(): string {
  counter += 1;
  return `phone-${counter}`;
}

export function emptyOrganizationDraft(): OrganizationDraft {
  return {
    title: '',
    organizationType: 'other',
    phones: [],
    website: '',
    address: '',
    openingHours: '',
    note: '',
  };
}

export function organizationDraft(title: string, data: OrganizationData): OrganizationDraft {
  return {
    title,
    organizationType: data.organizationType,
    phones: data.phones.map((phone) => ({
      key: nextPhoneKey(),
      number: phone.number,
      label: phone.label,
      emergency: phone.emergency,
    })),
    website: data.website ?? '',
    address: data.address,
    openingHours: data.openingHours,
    note: data.note,
  };
}

export function addPhone(phones: readonly PhoneDraft[]): PhoneDraft[] {
  if (phones.length >= MAX_PHONES) return [...phones];
  return [...phones, { key: nextPhoneKey(), number: '', label: '', emergency: false }];
}

export function updatePhone(
  phones: readonly PhoneDraft[],
  key: string,
  change: Partial<Omit<PhoneDraft, 'key'>>,
): PhoneDraft[] {
  return phones.map((phone) => (phone.key === key ? { ...phone, ...change } : phone));
}

export function removePhone(phones: readonly PhoneDraft[], key: string): PhoneDraft[] {
  return phones.filter((phone) => phone.key !== key);
}

export interface OrganizationErrors {
  title?: string;
  website?: string;
  address?: string;
  openingHours?: string;
  note?: string;
  /** Ошибка телефона по ключу строки. */
  phones: Record<string, string>;
}

export type OrganizationResult =
  | { ok: true; title: string; data: OrganizationData }
  | { ok: false; errors: OrganizationErrors };

/** Данные для сохранения. Совсем пустые строки телефонов пропускаются, адрес сайта нормализуется. */
export function toOrganizationInput(draft: OrganizationDraft): OrganizationResult {
  const errors: OrganizationErrors = { phones: {} };
  const title = draft.title.trim();
  if (title === '') errors.title = 'Введите название: без него организацию не сохранить.';
  else if (title.length > MAX_TITLE)
    errors.title = `Название длиннее ${MAX_TITLE} знаков. Сократите его.`;

  const website = parseLink(draft.website);
  if (!website.ok)
    errors.website =
      'Сайт — ссылка, которая начинается с http:// или https://, например example.ru.';

  const address = draft.address.trim();
  if (address.length > MAX_TEXT) errors.address = `Адрес длиннее ${MAX_TEXT} знаков.`;
  const openingHours = draft.openingHours.trim();
  if (openingHours.length > MAX_TEXT)
    errors.openingHours = `Часы работы длиннее ${MAX_TEXT} знаков.`;
  if (draft.note.length > MAX_NOTE) errors.note = `Заметка длиннее ${MAX_NOTE} знаков.`;

  const phones: OrganizationData['phones'] = [];
  for (const phone of draft.phones) {
    const number = phone.number.trim();
    const label = phone.label.trim();
    if (number === '' && label === '' && !phone.emergency) continue;
    if (number === '') errors.phones[phone.key] = 'Укажите номер или очистите строку.';
    else if (number.length > MAX_NUMBER)
      errors.phones[phone.key] = `Номер длиннее ${MAX_NUMBER} знаков.`;
    else if (label.length > MAX_LABEL)
      errors.phones[phone.key] = `Подпись длиннее ${MAX_LABEL} знаков.`;
    else phones.push({ number, label, emergency: phone.emergency });
  }

  const failed =
    errors.title !== undefined ||
    errors.website !== undefined ||
    errors.address !== undefined ||
    errors.openingHours !== undefined ||
    errors.note !== undefined ||
    Object.keys(errors.phones).length > 0;
  if (failed || !website.ok) return { ok: false, errors };
  return {
    ok: true,
    title,
    data: {
      organizationType: draft.organizationType,
      phones,
      website: website.url,
      address,
      openingHours,
      note: draft.note,
    },
  };
}
