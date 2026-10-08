import { CalendarDate, type UtilityAccountData } from '@homecrm/shared';
import { parseLink } from '../ui/link.ts';
import { type AccountCard, DEFAULT_ACCOUNT_TITLE, MAX_TITLE } from './api.ts';
import {
  type MonthlyRule,
  type Payer,
  payDayOf,
  SERVICE_LABELS,
  type Transmission,
  type TransmissionMethod,
  type UtilityService,
  windowOf,
} from './labels.ts';

// Форма лицевого счёта (UTIL-2): чистые функции без React. Всё необязательно; название по
// умолчанию — «Лицевой счёт». Окно передачи показаний и срок оплаты — ежемесячные правила DEAD-1.

export const MAX_NUMBER = 200;
export const MAX_NOTE = 10_000;
export const MAX_PHONE = 100;

export interface AccountDraft {
  title: string;
  /** Выбранный поставщик; пусто — «не указан» (или «не менять», если он скрыт). */
  supplierId: string;
  services: UtilityService[];
  number: string;
  method: TransmissionMethod | '';
  providerUrl: string;
  phone: string;
  /** Число месяца, с которого открыто окно передачи показаний; пусто — окна нет. */
  readFrom: string;
  /** Число месяца, по которое открыто окно; пусто — только один день. */
  readTo: string;
  payDay: string;
  payer: Payer;
  cabinetUrl: string;
  note: string;
}

export function emptyAccountDraft(): AccountDraft {
  return {
    title: '',
    supplierId: '',
    services: [],
    number: '',
    method: '',
    providerUrl: '',
    phone: '',
    readFrom: '',
    readTo: '',
    payDay: '',
    payer: 'owner',
    cabinetUrl: '',
    note: '',
  };
}

export function accountDraft(card: AccountCard): AccountDraft {
  const { data } = card;
  const span = windowOf(data.readingRule);
  return {
    // Введённое название при правке не подменяется: пустым поле бывает только у нового счёта.
    title: card.title,
    supplierId: card.supplier?.id ?? '',
    services: data.services,
    number: data.number,
    method: data.transmission?.method ?? '',
    providerUrl: data.transmission?.method === 'provider' ? data.transmission.url : '',
    phone: data.transmission?.method === 'phone' ? data.transmission.phone : '',
    readFrom: span === null ? '' : String(span.from),
    readTo: span?.to ? String(span.to) : '',
    payDay: String(payDayOf(data.paymentRule) ?? ''),
    payer: data.payer,
    cabinetUrl: data.cabinetUrl ?? '',
    note: data.note,
  };
}

export function toggleService(
  services: readonly UtilityService[],
  service: UtilityService,
  on: boolean,
): UtilityService[] {
  const rest = services.filter((item) => item !== service);
  return on ? [...rest, service] : rest;
}

/**
 * Название счёта. Пустое → по услугам («Электроэнергия» или «Электроэнергия, Газ»), без услуг —
 * «Лицевой счёт»: три счёта одной квартиры не должны выглядеть одинаково.
 */
export function deriveTitle(title: string, services: readonly UtilityService[]): string {
  const own = title.trim();
  if (own !== '') return own;
  if (services.length === 0) return DEFAULT_ACCOUNT_TITLE;
  const names = services.slice(0, 2).map((service) => SERVICE_LABELS[service]);
  const more = services.length - names.length;
  return (more > 0 ? `${names.join(', ')} и ещё ${more}` : names.join(', ')).slice(0, MAX_TITLE);
}

export interface AccountErrors {
  title?: string;
  number?: string;
  providerUrl?: string;
  phone?: string;
  readFrom?: string;
  readTo?: string;
  payDay?: string;
  cabinetUrl?: string;
  note?: string;
}

export type AccountResult =
  | { ok: true; title: string; data: UtilityAccountData }
  | { ok: false; errors: AccountErrors };

const DAY_ERROR = 'Число месяца — от 1 до 31.';

function parseDay(text: string): number | null | 'bad' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d{1,2}$/.test(value)) return 'bad';
  const day = Number(value);
  return day >= 1 && day <= 31 ? day : 'bad';
}

function monthlyRule(
  base: MonthlyRule | null,
  day: number,
  endDay: number | null,
  anchor: string,
): MonthlyRule {
  const keep = base?.kind === 'repeat' ? base : null;
  return {
    kind: 'repeat',
    anchor: keep?.anchor ?? CalendarDate.parse(anchor),
    time: keep?.time ?? '00:00',
    ...(keep?.endTime === undefined ? {} : { endTime: keep.endTime }),
    durationDays: 0,
    warnings: keep?.warnings ?? [],
    repeat: { unit: 'month', every: 1, day, ...(endDay === null ? {} : { endDay }) },
  };
}

/**
 * Данные для сохранения. `base` — прежние данные счёта: части, которых форма не показывает
 * (время, предупреждения, якорь правила), не теряются. `today` — дата дома: от неё считается
 * первое наступление нового правила. Правило не пересобирается, если человек его не менял.
 */
export function toAccountInput(
  draft: AccountDraft,
  base: UtilityAccountData | null,
  today: string,
): AccountResult {
  const errors: AccountErrors = {};
  if (draft.title.trim().length > MAX_TITLE)
    errors.title = `Название длиннее ${MAX_TITLE} знаков. Сократите его.`;
  const number = draft.number.trim();
  if (number.length > MAX_NUMBER) errors.number = `Номер длиннее ${MAX_NUMBER} знаков.`;
  if (draft.note.length > MAX_NOTE) errors.note = `Заметка длиннее ${MAX_NOTE} знаков.`;

  let transmission: Transmission | null = null;
  if (draft.method === 'provider') {
    const url = parseLink(draft.providerUrl);
    if (!url.ok || url.url === null)
      errors.providerUrl =
        'Укажите ссылку на сайт или приложение поставщика: она начинается с http:// или https://.';
    else transmission = { method: 'provider', url: url.url };
  } else if (draft.method === 'phone') {
    const phone = draft.phone.trim();
    if (phone === '' || phone.length > MAX_PHONE)
      errors.phone = `Укажите телефон для передачи показаний (до ${MAX_PHONE} знаков).`;
    else transmission = { method: 'phone', phone };
  } else if (draft.method !== '') {
    transmission = { method: draft.method };
  }

  const cabinet = parseLink(draft.cabinetUrl);
  if (!cabinet.ok)
    errors.cabinetUrl = 'Личный кабинет — ссылка, которая начинается с http:// или https://.';

  const from = parseDay(draft.readFrom);
  const to = parseDay(draft.readTo);
  if (from === 'bad') errors.readFrom = DAY_ERROR;
  if (to === 'bad') errors.readTo = DAY_ERROR;
  if (from === null && to !== null && to !== 'bad')
    errors.readFrom = 'Укажите, с какого числа открыто окно.';
  const pay = parseDay(draft.payDay);
  if (pay === 'bad') errors.payDay = DAY_ERROR;

  if (
    Object.keys(errors).length > 0 ||
    !cabinet.ok ||
    from === 'bad' ||
    to === 'bad' ||
    pay === 'bad'
  )
    return { ok: false, errors };

  const baseWindow = windowOf(base?.readingRule ?? null);
  const baseFrom = baseWindow === null ? null : baseWindow.from;
  const baseTo = baseWindow?.to ?? null;
  const readingRule =
    from === null
      ? null
      : base?.readingRule && from === baseFrom && to === baseTo
        ? base.readingRule
        : monthlyRule(base?.readingRule ?? null, from, to, today);
  const paymentRule =
    pay === null
      ? null
      : base?.paymentRule && pay === payDayOf(base.paymentRule)
        ? base.paymentRule
        : monthlyRule(base?.paymentRule ?? null, pay, null, today);

  return {
    ok: true,
    title: deriveTitle(draft.title, draft.services),
    data: {
      services: draft.services,
      number,
      transmission,
      readingRule,
      paymentRule,
      payer: draft.payer,
      cabinetUrl: cabinet.url,
      note: draft.note,
    },
  };
}

/**
 * Что отправить в `supplierId` при правке. API отдаёт скрытого и отсутствующего поставщика
 * одинаково (`null`), поэтому ключ добавляется только если человек сам выбрал другое значение:
 * иначе сохранение других полей стёрло бы скрытого поставщика.
 */
export function supplierChange(
  initial: string | null,
  chosen: string,
): { supplierId?: string | null } {
  if (initial === null) return chosen === '' ? {} : { supplierId: chosen };
  if (chosen === initial) return {};
  return { supplierId: chosen === '' ? null : chosen };
}
