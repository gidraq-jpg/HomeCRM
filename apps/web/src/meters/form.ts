import { CalendarDate, MeterData, resolveMeterData } from '@homecrm/shared';
import type { MeterCard, MeterDataInput, MeterInput, ReadingInput } from './api.ts';
import { checkZone, type Digits, problemText } from './decimal.ts';
import {
  defaultMeterTitle,
  defaultVerificationYears,
  type MeterResource,
  ZONE_PRESETS,
} from './labels.ts';

// Форма счётчика (UTIL-3, UTIL-14): чистые функции без React. Обязателен только ресурс; модель,
// номер и место по умолчанию пусты, одна зона «Основная», 5 цифр до запятой и 3 после, интервал
// поверки — из приложения А, дата следующей поверки вычисляется и правится вручную.

export const MAX_TEXT = 200;
export const MAX_ZONE = 100;
export const DEFAULT_INTEGER_DIGITS = 5;
export const DEFAULT_FRACTION_DIGITS = 3;

export type ZoneCount = 1 | 2 | 3;

export interface MeterDraft {
  resource: MeterResource;
  /** Пусто — название по умолчанию из ресурса и места: «ХВС, санузел». */
  title: string;
  place: string;
  model: string;
  serialNumber: string;
  /** Лицевой счёт; пусто — не указан. */
  utilityAccountId: string;
  zoneCount: ZoneCount;
  /** Названия трёх зон; используются первые `zoneCount`. */
  zones: [string, string, string];
  integerDigits: string;
  fractionDigits: string;
  installedOn: string;
  verifiedOn: string;
  /** Пусто — интервал по умолчанию для ресурса. */
  verificationYears: string;
  /** Дата следующей поверки: пусто — вычисляется из даты поверки и интервала. */
  nextVerificationOn: string;
  /** Человек правил дату следующей поверки сам. */
  nextManual: boolean;
  status: 'active' | 'removed';
  /** Начальное показание (UTIL-14): дата и значения по зонам. */
  initialDate: string;
  initialValues: [string, string, string];
}

export function emptyMeterDraft(today: string, resource: MeterResource = 'cold_water'): MeterDraft {
  return {
    resource,
    title: '',
    place: '',
    model: '',
    serialNumber: '',
    utilityAccountId: '',
    zoneCount: 1,
    zones: [...ZONE_PRESETS[1], '', ''] as [string, string, string],
    integerDigits: String(DEFAULT_INTEGER_DIGITS),
    fractionDigits: String(DEFAULT_FRACTION_DIGITS),
    installedOn: '',
    verifiedOn: '',
    verificationYears: '',
    nextVerificationOn: '',
    nextManual: false,
    status: 'active',
    initialDate: today,
    initialValues: ['', '', ''],
  };
}

/** Форма правки: начинается с сохранённых значений счётчика. */
export function meterDraft(card: MeterCard, today: string): MeterDraft {
  const { data } = card;
  const count = Math.min(3, Math.max(1, data.zones.length)) as ZoneCount;
  const zones: [string, string, string] = [
    data.zones[0] ?? '',
    data.zones[1] ?? '',
    data.zones[2] ?? '',
  ];
  return {
    ...emptyMeterDraft(today, data.resource),
    title: card.title,
    place: data.installationPlace,
    model: data.model,
    serialNumber: data.serialNumber,
    utilityAccountId: card.utilityAccountId ?? '',
    zoneCount: count,
    zones,
    integerDigits: String(data.integerDigits),
    fractionDigits: String(data.fractionDigits),
    installedOn: data.installedOn ?? '',
    verifiedOn: data.verifiedOn ?? '',
    verificationYears: data.verificationYears === undefined ? '' : String(data.verificationYears),
    nextVerificationOn: data.nextVerificationOn ?? '',
    status: data.status === 'removed' ? 'removed' : 'active',
  };
}

/** Смена числа тарифов подставляет типичные названия зон, пока человек их не менял. */
export function withZoneCount(draft: MeterDraft, count: ZoneCount): MeterDraft {
  const known = [1, 2, 3].map((n) => ZONE_PRESETS[n as ZoneCount]);
  const untouched = known.some(
    (preset) => draft.zones.slice(0, preset.length).join('|') === preset.join('|'),
  );
  const zones: [string, string, string] = untouched
    ? [ZONE_PRESETS[count][0] ?? '', ZONE_PRESETS[count][1] ?? '', ZONE_PRESETS[count][2] ?? '']
    : draft.zones;
  return { ...draft, zoneCount: count, zones };
}

function isDate(text: string): boolean {
  return CalendarDate.safeParse(text).success;
}

/** Дата следующей поверки, как её посчитает сервер; `null`, пока нет даты поверки. */
export function computedNextVerification(
  resource: MeterResource,
  verifiedOn: string,
  years: string,
): string | null {
  if (!isDate(verifiedOn)) return null;
  const interval = parseYears(years);
  if (interval === 'bad') return null;
  try {
    const resolved = resolveMeterData(
      MeterData.parse({
        resource,
        verifiedOn,
        ...(interval === null ? {} : { verificationYears: interval }),
      }),
    );
    return resolved.nextVerificationOn ?? null;
  } catch {
    return null;
  }
}

function parseYears(text: string): number | null | 'bad' {
  const value = text.trim();
  if (value === '') return null;
  if (!/^\d{1,2}$/.test(value)) return 'bad';
  const years = Number(value);
  return years >= 1 && years <= 50 ? years : 'bad';
}

function parseDigits(text: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

export interface MeterErrors {
  title?: string;
  place?: string;
  model?: string;
  serialNumber?: string;
  zones?: (string | undefined)[];
  integerDigits?: string;
  fractionDigits?: string;
  installedOn?: string;
  verifiedOn?: string;
  verificationYears?: string;
  nextVerificationOn?: string;
  initialDate?: string;
  initialValues?: (string | undefined)[];
}

export interface MeterFormOptions {
  /** Показание обязательно (замена): иначе начальное показание можно не вводить. */
  initialRequired: boolean;
  /** Показания уже есть или это правка: ресурс, зоны и разрядность не меняются. */
  structureLocked: boolean;
}

export type MeterResult = { ok: true; input: MeterInput } | { ok: false; errors: MeterErrors };

const DATE_ERROR = 'Укажите дату полностью: день, месяц и год.';

/** Читает начальное показание: пусто — его нет; иначе значения всех зон и дата обязательны. */
function readInitial(
  draft: MeterDraft,
  digits: Digits,
  required: boolean,
  errors: MeterErrors,
): ReadingInput | null {
  const entered = draft.initialValues.slice(0, draft.zoneCount);
  const any = entered.some((value) => value.trim() !== '');
  if (!any && !required) return null;
  if (!isDate(draft.initialDate)) errors.initialDate = DATE_ERROR;
  const values: string[] = [];
  const problems: (string | undefined)[] = [];
  entered.forEach((value, index) => {
    const checked = checkZone(digits, value, null, false);
    if (checked.status === 'ok') {
      values.push(checked.value);
      problems.push(undefined);
    } else if (checked.status === 'empty') {
      problems.push(
        draft.zoneCount === 1
          ? 'Введите показание счётчика.'
          : `Введите значение для зоны «${draft.zones[index]?.trim() || index + 1}».`,
      );
    } else {
      problems.push(problemText(checked.problem, digits));
    }
  });
  if (problems.some((problem) => problem !== undefined)) errors.initialValues = problems;
  return { occurredOn: draft.initialDate, values };
}

/**
 * Данные для сохранения. Ошибки названы у поля, по-русски. Дата следующей поверки уходит на
 * сервер только если её поправили вручную: иначе сервер сам вычислит её из даты поверки.
 */
export function toMeterInput(draft: MeterDraft, options: MeterFormOptions): MeterResult {
  const errors: MeterErrors = {};
  const place = draft.place.trim();
  const model = draft.model.trim();
  const serial = draft.serialNumber.trim();
  const title =
    draft.title.trim() === '' ? defaultMeterTitle(draft.resource, place) : draft.title.trim();
  if (title.length > MAX_TEXT) errors.title = `Название длиннее ${MAX_TEXT} знаков. Сократите его.`;
  if (place.length > MAX_TEXT) errors.place = `Место длиннее ${MAX_TEXT} знаков.`;
  if (model.length > MAX_TEXT) errors.model = `Модель длиннее ${MAX_TEXT} знаков.`;
  if (serial.length > MAX_TEXT) errors.serialNumber = `Номер длиннее ${MAX_TEXT} знаков.`;

  const zoneNames = draft.zones.slice(0, draft.zoneCount).map((zone) => zone.trim());
  const zoneProblems = zoneNames.map((zone) =>
    zone === ''
      ? 'Назовите зону, например «День».'
      : zone.length > MAX_ZONE
        ? `Название зоны длиннее ${MAX_ZONE} знаков.`
        : undefined,
  );
  if (draft.zoneCount > 1 && zoneProblems.some((problem) => problem !== undefined)) {
    errors.zones = zoneProblems;
  }
  const zones = draft.zoneCount === 1 && zoneNames[0] === '' ? ['Основная'] : zoneNames;

  const integerDigits = parseDigits(draft.integerDigits, 1, 12);
  const fractionDigits = parseDigits(draft.fractionDigits, 0, 6);
  if (integerDigits === null) errors.integerDigits = 'Цифр до запятой — от 1 до 12.';
  if (fractionDigits === null) errors.fractionDigits = 'Цифр после запятой — от 0 до 6.';

  if (draft.installedOn !== '' && !isDate(draft.installedOn)) errors.installedOn = DATE_ERROR;
  if (draft.verifiedOn !== '' && !isDate(draft.verifiedOn)) errors.verifiedOn = DATE_ERROR;
  const years = parseYears(draft.verificationYears);
  if (years === 'bad') errors.verificationYears = 'Интервал поверки — от 1 до 50 лет.';
  const manualNext = draft.nextManual && draft.nextVerificationOn !== '';
  if (manualNext && !isDate(draft.nextVerificationOn)) errors.nextVerificationOn = DATE_ERROR;

  const digits: Digits | null =
    integerDigits !== null && fractionDigits !== null ? { integerDigits, fractionDigits } : null;
  let initialReading: ReadingInput | null = null;
  if (digits !== null) {
    initialReading = readInitial(draft, digits, options.initialRequired, errors);
  }

  if (Object.keys(errors).length > 0 || digits === null || years === 'bad') {
    return { ok: false, errors };
  }
  const data: MeterDataInput = {
    resource: draft.resource,
    model,
    serialNumber: serial,
    installationPlace: place,
    zones,
    integerDigits: digits.integerDigits,
    fractionDigits: digits.fractionDigits,
    installedOn: draft.installedOn === '' ? null : draft.installedOn,
    verifiedOn: draft.verifiedOn === '' ? null : draft.verifiedOn,
    ...(years === null ? {} : { verificationYears: years }),
    ...(manualNext ? { nextVerificationOn: draft.nextVerificationOn } : {}),
    status: draft.status,
  };
  return {
    ok: true,
    input: {
      title,
      utilityAccountId: draft.utilityAccountId === '' ? null : draft.utilityAccountId,
      data,
      ...(initialReading === null ? {} : { initialReading }),
    },
  };
}

/**
 * Правка существующего счётчика: PATCH заменяет `data` целиком, поэтому неизменяемое берётся из
 * карточки (единица, зоны, разрядность, ресурс). Пересчёт даты поверки сервер делает сам, если
 * её не передавать; вручную поставленную дату форма сохраняет, пока дату поверки и интервал не
 * меняли.
 */
export function toMeterPatch(
  draft: MeterDraft,
  card: MeterCard,
):
  | { ok: true; title: string; utilityAccountId: string | null; data: MeterDataInput }
  | { ok: false; errors: MeterErrors } {
  const result = toMeterInput(
    {
      ...draft,
      resource: card.data.resource,
      zoneCount: Math.min(3, card.data.zones.length) as ZoneCount,
      zones: [card.data.zones[0] ?? '', card.data.zones[1] ?? '', card.data.zones[2] ?? ''],
      integerDigits: String(card.data.integerDigits),
      fractionDigits: String(card.data.fractionDigits),
    },
    { initialRequired: false, structureLocked: true },
  );
  if (!result.ok) return result;
  const data: MeterDataInput = { ...result.input.data };
  const base = card.data;
  if (!draft.nextManual) {
    const changed =
      (draft.verifiedOn === '' ? null : draft.verifiedOn) !== (base.verifiedOn ?? null) ||
      parseYears(draft.verificationYears) !== (base.verificationYears ?? null);
    // Пока дату поверки и интервал не меняли, прежняя следующая дата (в том числе
    // поправленная вручную) остаётся как есть; иначе сервер пересчитает её сам.
    if (!changed) data.nextVerificationOn = base.nextVerificationOn ?? null;
  }
  if (base.unit !== undefined) data.unit = base.unit;
  return {
    ok: true,
    title: result.input.title ?? card.title,
    utilityAccountId: result.input.utilityAccountId ?? null,
    data,
  };
}

/** Интервал по умолчанию как подсказка рядом с полем. */
export function yearsHint(resource: MeterResource): number {
  return defaultVerificationYears(resource);
}
