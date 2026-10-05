import type { PropertyStatus } from './model.ts';

/** Статус недвижимости: «живём», «сдаётся», «пустует» (UTIL-1). */
export const PROPERTY_STATUS_LABELS: Readonly<Record<PropertyStatus, string>> = {
  live: 'Живём',
  rent: 'Сдаётся',
  empty: 'Пустует',
};
