import { z } from 'zod';
import { DeadlineRule } from './deadlines.ts';

export const PROPERTY_KINDS = [
  'apartment',
  'house',
  'dacha_land',
  'garage_parking',
  'non_residential',
] as const;
export const PROPERTY_STATUSES = ['living', 'rented', 'vacant'] as const;
export const ORGANIZATION_TYPES = [
  'management',
  'utility',
  'bank',
  'insurance',
  'school',
  'clinic',
  'service',
  'shop',
  'government',
  'other',
] as const;
export const UTILITY_SERVICES = [
  'maintenance',
  'unified_bill',
  'electricity',
  'water_sewerage',
  'heating',
  'gas',
  'waste',
  'capital_repairs',
  'internet_tv',
  'intercom',
  'other',
] as const;
const text = z.string().trim().max(4000);
export const WebLink = z
  .url()
  .max(2000)
  .refine((value) => /^https?:\/\//i.test(value));
/** Площадь — целые сотые м²; пустой объект v0.1.0 остаётся валиден. */
export const PropertyData = z.strictObject({
  kind: z.enum(PROPERTY_KINDS).optional(),
  address: text.optional(),
  areaHundredths: z.number().int().safe().nonnegative().optional(),
  cadastralNumber: z
    .string()
    .regex(/^\d{2}:\d{2}:\d{6,7}:\d{1,10}$/)
    .optional(),
  status: z.enum(PROPERTY_STATUSES).optional(),
  ownerMemberIds: z
    .array(z.uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length)
    .optional(),
});
export type PropertyData = z.infer<typeof PropertyData>;
export const OrganizationData = z.strictObject({
  organizationType: z.enum(ORGANIZATION_TYPES).default('other'),
  phones: z
    .array(
      z.strictObject({
        number: z.string().trim().min(1).max(100),
        label: z.string().trim().max(200).default(''),
        emergency: z.boolean().default(false),
      }),
    )
    .max(20)
    .default([]),
  website: WebLink.nullable().default(null),
  address: text.default(''),
  openingHours: text.default(''),
  note: z.string().max(10000).default(''),
});
export type OrganizationData = z.infer<typeof OrganizationData>;
/** Ежемесячное окно в формате DEAD-1; endDay сохраняет календарную границу месяца. */
export const MonthlyRule = DeadlineRule.refine(
  (rule) =>
    rule.kind === 'repeat' &&
    rule.repeat.unit === 'month' &&
    rule.repeat.every === 1 &&
    (rule.repeat.endDay === undefined || rule.durationDays === 0),
);
export const UtilityAccountData = z.strictObject({
  services: z
    .array(z.enum(UTILITY_SERVICES))
    .max(UTILITY_SERVICES.length)
    .refine((items) => new Set(items).size === items.length)
    .default([]),
  number: z.string().trim().max(200).default(''),
  transmission: z
    .discriminatedUnion('method', [
      z.strictObject({ method: z.literal('gosuslugi_dom') }),
      z.strictObject({ method: z.literal('provider'), url: WebLink }),
      z.strictObject({ method: z.literal('phone'), phone: z.string().trim().min(1).max(100) }),
      z.strictObject({ method: z.literal('automatic') }),
      z.strictObject({ method: z.literal('not_required') }),
    ])
    .nullable()
    .default(null),
  readingRule: MonthlyRule.nullable().default(null),
  paymentRule: MonthlyRule.refine(
    (rule) =>
      rule.durationDays === 0 &&
      (rule.kind !== 'repeat' || rule.repeat.unit !== 'month' || rule.repeat.endDay === undefined),
  )
    .nullable()
    .default(null),
  payer: z.enum(['owner', 'tenant', 'other']).default('owner'),
  cabinetUrl: WebLink.nullable().default(null),
  note: z.string().max(10000).default(''),
});
export type UtilityAccountData = z.infer<typeof UtilityAccountData>;
