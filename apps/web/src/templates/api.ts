import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// Шаблоны и первый запуск (TPL-1…4, ADR-0034, docs/templates-charges-api.md). Каталог приходит с
// сервера: клиент берёт из него только идентификаторы, названия и стартовые галочки. Названия
// объектов, адреса и показания живут только в памяти страницы: в адреса, журнал, localStorage и
// кэш сервис-воркера они не попадают.

const Item = z.object({
  id: z.string(),
  title: z.string(),
  selected: z.boolean().default(true),
});
export type TemplateItem = z.infer<typeof Item>;

const MeterItem = Item.extend({ accountId: z.string() });
export type TemplateMeter = z.infer<typeof MeterItem>;

export const TAX_REGIMES = ['npd', 'ndfl'] as const;
export type TaxRegime = (typeof TAX_REGIMES)[number];

const TaxRegimeItem = z.object({
  id: z.enum(TAX_REGIMES),
  title: z.string(),
  deadlines: z.array(z.object({ id: z.string(), title: z.string() })),
});
export type TaxRegimeItem = z.infer<typeof TaxRegimeItem>;

export const Template = z.object({
  id: z.string(),
  title: z.string(),
  accounts: z.array(Item),
  meters: z.array(MeterItem),
  organizations: z.array(Item),
  deadlines: z.array(Item),
  taxRegimes: z.array(TaxRegimeItem),
});
export type Template = z.infer<typeof Template>;

export function fetchTemplates(signal?: AbortSignal) {
  return apiRequest('GET', 'templates', z.array(Template), undefined, signal);
}

const Onboarding = z.object({
  households: z.array(z.object({ householdId: z.string(), empty: z.boolean() })),
  needsFirstObject: z.boolean(),
});
export type Onboarding = z.infer<typeof Onboarding>;

/** Пуст ли дом администратора: по этому решается, показывать ли мастер первого запуска. */
export function fetchOnboarding(signal?: AbortSignal) {
  return apiRequest('GET', 'onboarding', Onboarding, undefined, signal);
}

export interface ApplyRequest {
  /** Ключ идемпотентности: повтор того же запроса возвращает тот же объект, а не второй. */
  idempotencyKey: string;
  title: string;
  propertyData?: { address: string };
  placement?: { spaceId: string; audience?: 'household' | 'adults' };
  /** Дом календаря для личного объекта со сроками. */
  householdId?: string;
  accounts: { id: string }[];
  meters: { id: string; initialReading?: { occurredOn: string; values: string[] } }[];
  organizations: string[];
  deadlines: { id: string }[];
  taxRegime?: TaxRegime;
}

const Applied = z.object({ objectId: z.string() });

/** Одно действие: объект и все выбранные пункты создаются вместе или не создаются совсем. */
export function applyTemplate(templateId: string, request: ApplyRequest) {
  return apiRequest('POST', `templates/${templateId}/apply`, Applied, request);
}
