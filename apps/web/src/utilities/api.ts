import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// «Коммуналка за месяц» и аналитика объекта — ADR-0035, docs/month-documents-api.md (UTIL-11, UTIL-12).
// Суммы приходят целыми копейками, расход — точной десятичной строкой: ни то ни другое не проходит
// через дробные числа. Названия объектов и счетов живут только в ответах и памяти страницы.

export const ACCOUNT_STATUSES = [
  'transmitted',
  'not_transmitted',
  'not_open',
  'not_required',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

const Cents = z.number().int();

export const MonthAccount = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(ACCOUNT_STATUSES),
});
export type MonthAccount = z.infer<typeof MonthAccount>;

const Money = z.object({ chargedCents: Cents, paidCents: Cents, remainingCents: Cents });

export const MonthObject = Money.extend({
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(['household', 'adults']).nullable(),
  id: z.string(),
  title: z.string(),
  accounts: z.array(MonthAccount),
});
export type MonthObject = z.infer<typeof MonthObject>;

export const MonthOverview = z.object({
  month: z.string(),
  objects: z.array(MonthObject),
  totals: Money,
});
export type MonthOverview = z.infer<typeof MonthOverview>;

export function fetchMonth(month: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ month });
  return apiRequest('GET', `utilities/month?${query}`, MonthOverview, undefined, signal);
}

export const ConsumptionItem = z.object({
  resource: z.string(),
  unit: z
    .string()
    .nullish()
    .transform((unit) => unit ?? ''),
  /** Точная десятичная строка: «123.456». */
  value: z.string(),
});
export type ConsumptionItem = z.infer<typeof ConsumptionItem>;

const MonthStats = z.object({
  month: z.string(),
  chargedCents: Cents,
  paidCents: Cents,
  consumption: z.array(ConsumptionItem),
});

export const AnalyticsMonth = MonthStats.extend({
  /** Тот же месяц годом раньше; у сервера он есть всегда, пустой месяц — с нулями. */
  previousYear: MonthStats.nullable(),
});
export type AnalyticsMonth = z.infer<typeof AnalyticsMonth>;

export const ObjectAnalytics = z.object({
  objectId: z.string(),
  months: z.array(AnalyticsMonth),
});
export type ObjectAnalytics = z.infer<typeof ObjectAnalytics>;

export function fetchAnalytics(objectId: string, signal?: AbortSignal) {
  return apiRequest('GET', `objects/${objectId}/analytics`, ObjectAnalytics, undefined, signal);
}
