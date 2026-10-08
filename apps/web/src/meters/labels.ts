import { METER_RESOURCES, VERIFICATION_YEARS } from '@homecrm/shared';
import { countWord } from '../ui/format.ts';

// Тексты счётчиков (UTIL-3, приложение А PRD): ресурсы, единицы, зоны, интервалы поверки.

export type MeterResource = (typeof METER_RESOURCES)[number];
export type MeterState = 'active' | 'replaced' | 'removed';

export const RESOURCES: readonly MeterResource[] = METER_RESOURCES;

/** Полные названия — для выбора ресурса. */
export const RESOURCE_LABELS: Readonly<Record<MeterResource, string>> = {
  cold_water: 'Холодная вода (ХВС)',
  hot_water: 'Горячая вода (ГВС)',
  electricity: 'Электроэнергия',
  gas: 'Газ',
  heat: 'Тепло',
};

/** Короткие названия — для заголовков счётчиков и подписей. */
export const RESOURCE_SHORT: Readonly<Record<MeterResource, string>> = {
  cold_water: 'ХВС',
  hot_water: 'ГВС',
  electricity: 'Электроэнергия',
  gas: 'Газ',
  heat: 'Тепло',
};

/** Единица по умолчанию: ту же подставляет сервер. */
export const RESOURCE_UNITS: Readonly<Record<MeterResource, string>> = {
  cold_water: 'м³',
  hot_water: 'м³',
  electricity: 'кВт·ч',
  gas: 'м³',
  heat: 'Гкал',
};

export const STATE_LABELS: Readonly<Record<MeterState, string>> = {
  active: 'Работает',
  replaced: 'Заменён',
  removed: 'Снят',
};

/** Интервал поверки по умолчанию, лет — приложение А PRD. */
export const defaultVerificationYears = (resource: MeterResource) => VERIFICATION_YEARS[resource];

/** Типичные названия зон по числу тарифов. */
export const ZONE_PRESETS: Readonly<Record<1 | 2 | 3, readonly string[]>> = {
  1: ['Основная'],
  2: ['День', 'Ночь'],
  3: ['Пик', 'Полупик', 'Ночь'],
};

export const ZONE_COUNT_LABELS: Readonly<Record<1 | 2 | 3, string>> = {
  1: 'Один тариф',
  2: 'Два тарифа (день и ночь)',
  3: 'Три тарифа (пик, полупик, ночь)',
};

/** Сколько счётчиков по-русски: «1 счётчик», «2 счётчика», «5 счётчиков». */
export const meterCount = (count: number) => countWord(count, ['счётчик', 'счётчика', 'счётчиков']);

/** Название счётчика по умолчанию: «ХВС, санузел». */
export function defaultMeterTitle(resource: MeterResource, place: string): string {
  const where = place.trim();
  return where === '' ? RESOURCE_SHORT[resource] : `${RESOURCE_SHORT[resource]}, ${where}`;
}

/** «Основная» у одной зоны не нужна: подпись поля — просто единица. */
export function zoneLabel(zones: readonly string[], index: number): string | null {
  return zones.length === 1 ? null : (zones[index] ?? `Зона ${index + 1}`);
}
