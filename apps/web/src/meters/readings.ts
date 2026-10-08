import type { MeterListItem, ReadingInput } from './api.ts';
import { checkZone, type Digits, problemText, type ZoneResult } from './decimal.ts';

// Ввод показаний по объекту (UTIL-7, S3): чистые функции без React. Проверка до отправки
// повторяет правила сервера (UTIL-5): формат, точность, «не меньше прошлого» с двумя
// исключениями — переход через ноль и замена счётчика.

/** Что человек ввёл по одному счётчику: значения по зонам и отметка «переход через ноль». */
export interface ReadingDraft {
  values: string[];
  rollover: boolean;
}

export const emptyDraft = (zones: number): ReadingDraft => ({
  values: Array.from({ length: zones }, () => ''),
  rollover: false,
});

export const digitsOf = (meter: MeterListItem): Digits => ({
  integerDigits: meter.data.integerDigits,
  fractionDigits: meter.data.fractionDigits,
});

export interface MeterEntry {
  /** Хотя бы одна зона заполнена: счётчик попадёт в «Сохранить всё». */
  entered: boolean;
  /** Текст ошибки у каждой зоны; `undefined` — зона в порядке. */
  problems: (string | undefined)[];
  /** Хотя бы одна зона меньше прошлого, а переход через ноль не отмечен. */
  lower: boolean;
  /** Хотя бы одна зона меньше прошлого (в том числе с отметкой перехода). */
  anyLower: boolean;
  valid: boolean;
  /** Значения для отправки, если счётчик заполнен верно. */
  values: string[];
  /** Расход по зонам, если он известен. */
  consumption: (string | null)[];
}

export function evaluateMeter(meter: MeterListItem, draft: ReadingDraft | undefined): MeterEntry {
  const digits = digitsOf(meter);
  const zones = meter.data.zones;
  const inputs = zones.map((_, index) => draft?.values[index] ?? '');
  const entered = inputs.some((value) => value.trim() !== '');
  const previous = meter.previousReading?.values ?? [];
  const results: ZoneResult[] = inputs.map((input, index) =>
    checkZone(digits, input, previous[index] ?? null, draft?.rollover ?? false),
  );
  const problems: (string | undefined)[] = results.map((result, index) => {
    if (result.status === 'invalid') return problemText(result.problem, digits);
    if (result.status === 'empty' && entered) {
      return `Введите значение для зоны «${zones[index] ?? index + 1}».`;
    }
    return undefined;
  });
  const lower = results.some(
    (result) => result.status === 'invalid' && result.problem.kind === 'lower',
  );
  const anyLower = inputs.some((input, index) => {
    const before = previous[index];
    if (before === undefined) return false;
    const unrolled = checkZone(digits, input, before, false);
    return unrolled.status === 'invalid' && unrolled.problem.kind === 'lower';
  });
  const valid = entered && problems.every((problem) => problem === undefined);
  return {
    entered,
    problems,
    lower,
    anyLower,
    valid,
    values: results.map((result) => (result.status === 'ok' ? result.value : '')),
    consumption: results.map((result) => (result.status === 'ok' ? result.consumption : null)),
  };
}

/**
 * Дата показаний должна быть позже даты прошлого показания каждого вводимого счётчика
 * (повтор даты сервер отклоняет). Возвращает дату прошлого показания, мешающую вводу.
 */
export function blockingDate(
  meters: readonly MeterListItem[],
  drafts: Readonly<Record<string, ReadingDraft>>,
  date: string,
): string | null {
  let latest: string | null = null;
  for (const meter of meters) {
    if (!evaluateMeter(meter, drafts[meter.id]).entered) continue;
    const before = meter.previousReading?.occurredOn;
    if (before !== undefined && date <= before && (latest === null || before > latest)) {
      latest = before;
    }
  }
  return latest;
}

export interface Payload {
  readings: (ReadingInput & { meterId: string })[];
  /** Счётчики с ошибками: фокус уходит на первый из них. */
  invalid: string[];
}

export function buildPayload(
  meters: readonly MeterListItem[],
  drafts: Readonly<Record<string, ReadingDraft>>,
  date: string,
  photos: Readonly<Record<string, readonly string[]>>,
): Payload {
  const readings: Payload['readings'] = [];
  const invalid: string[] = [];
  for (const meter of meters) {
    const entry = evaluateMeter(meter, drafts[meter.id]);
    if (!entry.entered) continue;
    if (!entry.valid) {
      invalid.push(meter.id);
      continue;
    }
    const draft = drafts[meter.id];
    readings.push({
      meterId: meter.id,
      occurredOn: date,
      values: entry.values,
      ...(draft?.rollover && entry.anyLower ? { rollover: true } : {}),
      ...((photos[meter.id]?.length ?? 0) > 0 ? { photoIds: [...(photos[meter.id] ?? [])] } : {}),
    });
  }
  return { readings, invalid };
}
