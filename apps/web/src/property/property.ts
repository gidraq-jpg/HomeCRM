import type { PROPERTY_KINDS, PROPERTY_STATUSES, PropertyData } from '@homecrm/shared';

// Поля недвижимости (UTIL-1, ADR-0031): вид, адрес, площадь, кадастровый номер, статус и
// собственники-участники. Чистые функции без React: правила ввода можно проверить без браузера.

export type PropertyKind = (typeof PROPERTY_KINDS)[number];
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const PROPERTY_KIND_LABELS: Readonly<Record<PropertyKind, string>> = {
  apartment: 'Квартира',
  house: 'Дом',
  dacha_land: 'Дача или участок',
  garage_parking: 'Гараж или машиноместо',
  non_residential: 'Нежилое помещение',
};

export const PROPERTY_STATUS_LABELS: Readonly<Record<PropertyStatus, string>> = {
  living: 'Живём',
  rented: 'Сдаётся',
  vacant: 'Пустует',
};

export const MAX_ADDRESS = 4000;
export const CADASTRAL_HINT = 'Формат: 66:41:0101001:123 — части через двоеточие.';

const CADASTRAL = /^\d{2}:\d{2}:\d{6,7}:\d{1,10}$/;
const AREA = /^\d{1,9}(?:\.\d{1,2})?$/;

export type AreaInput = { ok: true; hundredths: number | null } | { ok: false };

/**
 * Площадь из поля ввода → целые сотые квадратного метра. Принимает запятую и точку, пробелы и
 * «м²» в конце; не больше двух знаков после запятой. Пустая строка — площади нет.
 */
export function parseArea(input: string): AreaInput {
  const cleaned = input
    .replace(/\s+/g, '')
    .replace(/м[²2]?\.?$/i, '')
    .replace(',', '.');
  if (cleaned === '') return { ok: true, hundredths: null };
  if (!AREA.test(cleaned)) return { ok: false };
  const [whole = '0', rest = ''] = cleaned.split('.');
  return { ok: true, hundredths: Number(whole) * 100 + Number(rest.padEnd(2, '0')) };
}

/** Сотые → строка для поля ввода: `54,3` или `57,31`. */
export function areaToInput(hundredths: number): string {
  const rest = hundredths % 100;
  const whole = Math.trunc(hundredths / 100);
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

const NBSP = String.fromCodePoint(0xa0);

/** Для показа: `54,3 м²`. */
export function formatArea(hundredths: number): string {
  return `${areaToInput(hundredths)}${NBSP}м²`;
}

export function isCadastralNumber(value: string): boolean {
  return CADASTRAL.test(value);
}

/** Что человек вводит в форме: строки и список выбранных собственников. */
export interface PropertyDraft {
  kind: PropertyKind | '';
  address: string;
  area: string;
  cadastralNumber: string;
  status: PropertyStatus | '';
  ownerMemberIds: string[];
}

export const EMPTY_PROPERTY: PropertyDraft = {
  kind: '',
  address: '',
  area: '',
  cadastralNumber: '',
  status: '',
  ownerMemberIds: [],
};

export function propertyDraft(data: PropertyData): PropertyDraft {
  return {
    kind: data.kind ?? '',
    address: data.address ?? '',
    area: data.areaHundredths === undefined ? '' : areaToInput(data.areaHundredths),
    cadastralNumber: data.cadastralNumber ?? '',
    status: data.status ?? '',
    ownerMemberIds: data.ownerMemberIds ?? [],
  };
}

export interface PropertyErrors {
  address?: string;
  area?: string;
  cadastralNumber?: string;
}

export type PropertyResult =
  | { ok: true; data: PropertyData }
  | { ok: false; errors: PropertyErrors };

/**
 * Поля для сохранения. PATCH заменяет поля типа целиком, поэтому пустое не отправляется вовсе.
 * Ошибки названы у поля, по-русски.
 */
export function toPropertyData(draft: PropertyDraft): PropertyResult {
  const errors: PropertyErrors = {};
  const address = draft.address.trim();
  if (address.length > MAX_ADDRESS) {
    errors.address = `Адрес длиннее ${MAX_ADDRESS} знаков. Сократите его.`;
  }
  const area = parseArea(draft.area);
  if (!area.ok) {
    errors.area =
      'Площадь — число с запятой или точкой, например 54,3. Не больше двух знаков после запятой.';
  }
  const cadastralNumber = draft.cadastralNumber.trim();
  if (cadastralNumber !== '' && !isCadastralNumber(cadastralNumber)) {
    errors.cadastralNumber = `Кадастровый номер не похож на настоящий. ${CADASTRAL_HINT}`;
  }
  if (Object.keys(errors).length > 0 || !area.ok) return { ok: false, errors };
  const data: PropertyData = {
    ...(draft.kind === '' ? {} : { kind: draft.kind }),
    ...(address === '' ? {} : { address }),
    ...(area.hundredths === null ? {} : { areaHundredths: area.hundredths }),
    ...(cadastralNumber === '' ? {} : { cadastralNumber }),
    ...(draft.status === '' ? {} : { status: draft.status }),
    ...(draft.ownerMemberIds.length === 0 ? {} : { ownerMemberIds: draft.ownerMemberIds }),
  };
  return { ok: true, data };
}

export function toggleOwner(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((item) => item !== id);
  return on ? [...rest, id] : rest;
}
