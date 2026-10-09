import { METER_RESOURCES } from '@homecrm/shared';
import { showDecimal } from '../meters/decimal.ts';
import { RESOURCE_SHORT } from '../meters/labels.ts';
import type { AnalyticsMonth, ConsumptionItem } from './api.ts';

// Аналитика объекта (UTIL-12): расход приходит точной десятичной строкой и на экран выводится
// строкой же. Числа (`Number`) нужны только для высоты столбцов диаграммы, текста из них нет.

export interface ResourceKey {
  resource: string;
  unit: string;
}

export const resourceId = (key: ResourceKey) => `${key.resource}|${key.unit}`;

/** «Электроэнергия, кВт·ч»: название ресурса и единица. */
export function resourceTitle(key: ResourceKey): string {
  const known = (METER_RESOURCES as readonly string[]).includes(key.resource);
  const name = known
    ? RESOURCE_SHORT[key.resource as keyof typeof RESOURCE_SHORT]
    : key.resource || 'Ресурс';
  return key.unit === '' ? name : `${name}, ${key.unit}`;
}

function order(resource: string): number {
  const index = (METER_RESOURCES as readonly string[]).indexOf(resource);
  return index === -1 ? METER_RESOURCES.length : index;
}

/** Ресурсы, по которым есть расход в любом из месяцев или годом раньше, в порядке справочника. */
export function resourcesOf(months: readonly AnalyticsMonth[]): ResourceKey[] {
  const found = new Map<string, ResourceKey>();
  for (const month of months) {
    for (const item of [...month.consumption, ...(month.previousYear?.consumption ?? [])]) {
      const key = { resource: item.resource, unit: item.unit };
      found.set(resourceId(key), key);
    }
  }
  return [...found.values()].sort(
    (a, b) => order(a.resource) - order(b.resource) || a.unit.localeCompare(b.unit, 'ru'),
  );
}

/** Расход ресурса в месяце — строкой, как пришёл; `null`, если расхода нет. */
export function consumptionIn(
  items: readonly ConsumptionItem[] | undefined,
  key: ResourceKey,
): string | null {
  return (
    items?.find((item) => item.resource === key.resource && item.unit === key.unit)?.value ?? null
  );
}

/** Для текста: запятая вместо точки, значение без изменений; пусто — тире. */
export function showConsumption(value: string | null): string {
  return value === null ? '—' : showDecimal(value);
}

/** Высота столбца в долях максимума; значения только для рисования. */
export function ratio(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(1, value / max);
}

export function maxOf(values: readonly number[]): number {
  return values.reduce((max, value) => (value > max ? value : max), 0);
}

/** Есть ли в аналитике хоть что-то, кроме нулей. */
export function hasData(months: readonly AnalyticsMonth[]): boolean {
  return months.some(
    (month) =>
      month.chargedCents !== 0 ||
      month.paidCents !== 0 ||
      month.consumption.length > 0 ||
      (month.previousYear?.chargedCents ?? 0) !== 0 ||
      (month.previousYear?.paidCents ?? 0) !== 0 ||
      (month.previousYear?.consumption.length ?? 0) > 0,
  );
}
