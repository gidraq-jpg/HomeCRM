import { PERSON_CATEGORIES } from '@homecrm/shared';
import { countWord, type DateOnly, formatFullDate, formatShortDate } from '../ui/format.ts';
import type { InteractionKind, PersonCategory } from './api.ts';
import type { ContactActions } from './schema.ts';

// Тексты людей и взаимодействий — PRD, раздел 13 и CONT-1…5: правильные формы числа, даты вида
// «5 окт.», суммы в рублях.

export const CATEGORY_LABELS: Readonly<Record<PersonCategory, string>> = {
  family: 'Семья',
  friend: 'Друзья',
  craftsperson: 'Мастер',
  doctor: 'Врач',
  tutor: 'Репетитор',
  neighbor: 'Сосед',
  tenant: 'Арендатор',
  other: 'Другое',
};

/** Множественное число для фильтра: «Мастера», «Врачи». */
export const CATEGORY_FILTER_LABELS: Readonly<Record<PersonCategory, string>> = {
  family: 'Семья',
  friend: 'Друзья',
  craftsperson: 'Мастера',
  doctor: 'Врачи',
  tutor: 'Репетиторы',
  neighbor: 'Соседи',
  tenant: 'Арендаторы',
  other: 'Другое',
};

export const CATEGORY_OPTIONS = PERSON_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}));

export const KIND_LABELS: Readonly<Record<InteractionKind, string>> = {
  call: 'Звонок',
  visit: 'Визит',
  message: 'Сообщение',
  work: 'Работа',
};

export const contactCount = (count: number) =>
  countWord(count, ['контакт', 'контакта', 'контактов']);

export const interactionCount = (count: number) =>
  countWord(count, ['запись', 'записи', 'записей']);

/** Категории человека одной строкой: «Врач, Сосед». */
export function categoriesLabel(categories: readonly PersonCategory[]): string {
  return categories.map((category) => CATEGORY_LABELS[category]).join(', ');
}

/** День рождения: «14 мар. 1990» с годом, «5 окт.» без года. */
export function birthdayLabel(birthday: string | null): string {
  if (birthday === null) return '—';
  if (birthday.startsWith('--')) return formatShortDate(`2000${birthday.slice(1)}` as DateOnly);
  return formatFullDate(birthday as DateOnly);
}

/** Ссылка на карту для адреса. Адрес уходит в сервис карт только по нажатию на «На карте». */
export function mapHref(address: string): string {
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

export interface PhoneLine {
  number: string;
  label: string;
  emergency: boolean;
  /** Ссылка `tel:` от сервера; у непригодного для звонка номера её нет. */
  href: string | null;
}

const digits = (value: string) => value.replace(/\D/g, '');

/**
 * Телефоны карточки вместе со ссылками `tel:` из ответа API. Сервер отдаёт ссылки только для
 * пригодных номеров и в том же порядке, поэтому пары ищутся по порядку и цифрам номера.
 */
export function phoneLines(
  phones: readonly { number: string; label: string; emergency: boolean }[],
  actions: ContactActions,
): PhoneLine[] {
  let next = 0;
  return phones.map((phone) => {
    const candidate = actions.phones[next];
    const matches = candidate !== undefined && digits(candidate.href) === digits(phone.number);
    if (matches) next += 1;
    return { ...phone, href: matches ? candidate.href : null };
  });
}

/** Телефон для крупной кнопки «Позвонить»: аварийный, иначе первый пригодный для звонка. */
export function primaryPhone(lines: readonly PhoneLine[]): PhoneLine | null {
  const callable = lines.filter((line) => line.href !== null);
  return callable.find((line) => line.emergency) ?? callable[0] ?? null;
}

/** Первая ссылка для «Написать»: мессенджер важнее почты. */
export function primaryMessage(actions: ContactActions): { href: string; label: string } | null {
  const messenger = actions.messengers[0];
  if (messenger) return { href: messenger.href, label: messenger.label };
  const email = actions.emails[0];
  return email ? { href: email.href, label: 'Электронная почта' } : null;
}
