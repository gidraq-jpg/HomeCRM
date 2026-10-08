import { AUDIENCES, MeterData, UtilityAccountData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// Счётчики и показания (UTIL-3…8, ADR-0032, docs/meters-readings-api.md). Значения и расход —
// десятичные строки, не числа. Заводские номера, значения и названия живут только в ответах и
// памяти страницы: в адреса, журнал, localStorage и кэш сервис-воркера они не попадают.

export type { MeterData };
/** Данные счётчика для отправки: даты — обычные строки `YYYY-MM-DD`. */
export type MeterDataInput = z.input<typeof MeterData>;

const Placement = {
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
};

export const ReadingCard = z.object({
  id: z.string(),
  title: z.string(),
  ...Placement,
  parentId: z.string(),
  /** Календарная дата `YYYY-MM-DD` без часового пояса. */
  occurredOn: z.string(),
  values: z.array(z.string()),
  /** Расход по зонам; у начального показания — `null`. */
  consumption: z.array(z.string()).nullable(),
  rollover: z.boolean(),
  comment: z.string(),
  takenBy: z.string(),
  transmissionStatus: z.enum(['pending', 'transmitted']),
  transmittedAt: z.string().nullable(),
  transmissionMethod: z.string().nullable(),
  photoIds: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});
export type ReadingCard = z.infer<typeof ReadingCard>;

export const MeterCard = z.object({
  id: z.string(),
  title: z.string(),
  ...Placement,
  parentId: z.string(),
  utilityAccountId: z.string().nullable(),
  previousMeterId: z.string().nullable(),
  data: MeterData,
});
export type MeterCard = z.infer<typeof MeterCard>;

/** Строка списка: счётчик и его последнее показание. */
export const MeterListItem = MeterCard.extend({ previousReading: ReadingCard.nullable() });
export type MeterListItem = z.infer<typeof MeterListItem>;

export const MeterCreated = MeterCard.extend({ initialReading: ReadingCard.nullable() });
export type MeterCreated = z.infer<typeof MeterCreated>;

export const Replaced = z.object({
  oldMeterId: z.string(),
  finalReading: ReadingCard,
  newMeter: MeterCreated,
});
export type Replaced = z.infer<typeof Replaced>;

export const TransmissionReading = ReadingCard.extend({
  meterId: z.string(),
  zones: z.array(z.string()),
  serialNumber: z.string(),
  installationPlace: z.string(),
});
export type TransmissionReading = z.infer<typeof TransmissionReading>;

export const TransmissionGroup = z.object({
  utilityAccountId: z.string().nullable(),
  number: z.string(),
  transmission: UtilityAccountData.shape.transmission,
  readings: z.array(TransmissionReading),
});
export type TransmissionGroup = z.infer<typeof TransmissionGroup>;

export type MeterStatus = 'active' | 'replaced' | 'removed' | 'all';

export function fetchMeters(objectId: string, status: MeterStatus, signal?: AbortSignal) {
  const query = new URLSearchParams({ status });
  return apiRequest(
    'GET',
    `objects/${objectId}/meters?${query}`,
    z.array(MeterListItem),
    undefined,
    signal,
  );
}

export interface ReadingInput {
  occurredOn: string;
  values: string[];
  rollover?: boolean;
  comment?: string;
  photoIds?: string[];
}

export interface MeterInput {
  title?: string;
  utilityAccountId?: string | null;
  data: MeterDataInput;
  initialReading?: ReadingInput;
}

export interface MeterChange {
  title?: string;
  utilityAccountId?: string | null;
  data?: MeterDataInput;
  expectedUpdatedAt?: string;
}

export function createMeter(objectId: string, input: MeterInput) {
  return apiRequest('POST', `objects/${objectId}/meters`, MeterCreated, input);
}

export function patchMeter(id: string, change: MeterChange) {
  return apiRequest('PATCH', `meters/${id}`, MeterCard, change);
}

export function replaceMeter(
  id: string,
  body: { finalReading: ReadingInput; newMeter: MeterInput & { initialReading: ReadingInput } },
) {
  return apiRequest('POST', `meters/${id}/replace`, Replaced, body);
}

/** «Сохранить всё»: показания нескольких счётчиков одного объекта одним запросом, всё или ничего. */
export function saveReadings(objectId: string, readings: (ReadingInput & { meterId: string })[]) {
  return apiRequest('POST', `objects/${objectId}/readings`, z.array(ReadingCard), { readings });
}

const Trashed = z.object({ id: z.string(), deletedAt: z.string().nullable() });

/** Последнее показание можно убрать в корзину и ввести заново: так исправляют значение. */
export function trashReading(id: string) {
  return apiRequest('POST', `readings/${id}/trash`, Trashed, {});
}

export function fetchTransmission(objectId: string, signal?: AbortSignal) {
  return apiRequest(
    'GET',
    `objects/${objectId}/transmission`,
    z.array(TransmissionGroup),
    undefined,
    signal,
  );
}

export function markTransmitted(objectId: string, readingIds: string[], method: string) {
  return apiRequest('POST', `objects/${objectId}/readings/transmit`, z.array(ReadingCard), {
    readingIds,
    method,
  });
}
