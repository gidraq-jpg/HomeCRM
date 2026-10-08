import { z } from 'zod';
import { DeadlineRule } from './deadlines.ts';
import { MeterData, ReadingInput, VERIFICATION_YEARS } from './meters.ts';
import { PropertyData, UTILITY_SERVICES, UtilityAccountData } from './utilities.ts';

const services = [
  ['maintenance', 'Содержание и ремонт или ЕПД'],
  ['electricity', 'Электроэнергия'],
  ['water_sewerage', 'Водоснабжение и водоотведение'],
  ['heating', 'Отопление'],
  ['gas', 'Газ'],
  ['waste', 'Обращение с ТКО'],
  ['capital_repairs', 'Взносы на капремонт'],
  ['internet_tv', 'Интернет и ТВ'],
  ['intercom', 'Домофон'],
] as const;
const resources = [
  ['cold_water', 'ХВС', 'water_sewerage'],
  ['hot_water', 'ГВС', 'water_sewerage'],
  ['electricity', 'Электроэнергия', 'electricity'],
  ['gas', 'Газ', 'gas'],
  ['heat', 'Тепло', 'heating'],
] as const;
const monthly = (day: number, endDay?: number) =>
  DeadlineRule.parse({
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day, ...(endDay ? { endDay } : {}) },
    warnings: endDay ? [0] : [3, 0],
    warningTime: '09:00',
    ...(endDay ? { endWarnings: [1, 0] } : {}),
  });
const annual = (month: number, day: number, warnings: number[] = [30, 7]) =>
  DeadlineRule.parse({
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'year', month, day },
    warnings,
    warningTime: '09:00',
  });
const tax = {
  id: 'property_tax',
  title: 'Оплатить налог на имущество',
  rule: annual(12, 1, [30, 11]),
};
const gas = { id: 'gas_service', title: 'ТО газового оборудования', rule: annual(10, 1) };
const organizations = [
  { id: 'management', title: 'УК или ТСЖ', organizationType: 'management', role: 'УК или ТСЖ' },
  {
    id: 'emergency',
    title: 'Аварийно-диспетчерская служба',
    organizationType: 'service',
    role: 'Аварийная служба',
  },
] as const;
function catalog(id: string, title: string, house = false, rented = false) {
  return {
    id,
    title,
    propertyData: { kind: house ? 'house' : 'apartment', status: rented ? 'rented' : 'living' },
    accounts: services
      .filter(
        ([service]) =>
          !house || ['electricity', 'gas', 'water_sewerage', 'waste'].includes(service),
      )
      .map(([id, title]) => ({
        id,
        title,
        selected: true,
        data: UtilityAccountData.parse({
          services: [id],
          readingRule: ['electricity', 'gas', 'water_sewerage', 'heating'].includes(id)
            ? monthly(20, 25)
            : null,
          paymentRule: monthly(15),
        }),
      })),
    meters: resources
      .filter(([resource]) => !house || ['electricity', 'gas', 'cold_water'].includes(resource))
      .map(([id, title, accountId]) => ({
        id,
        title,
        accountId,
        selected: true,
        data: MeterData.parse({ resource: id, verificationYears: VERIFICATION_YEARS[id] }),
      })),
    organizations: house ? [] : organizations.map((o) => ({ ...o, selected: true })),
    deadlines: [
      house ? { ...tax, title: 'Налог на имущество и земельный налог' } : tax,
      gas,
      ...(rented
        ? [{ id: 'tenant_readings', title: 'Получить показания от арендатора', rule: monthly(20) }]
        : []),
    ].map((d) => ({ ...d, selected: true })),
    taxRegimes: rented
      ? [
          {
            id: 'npd',
            title: 'НПД',
            deadlines: [{ id: 'npd', title: 'Оплатить НПД', rule: monthly(28) }],
          },
          {
            id: 'ndfl',
            title: 'НДФЛ',
            deadlines: [
              { id: 'ndfl_declaration', title: 'Подать декларацию НДФЛ', rule: annual(4, 30) },
              { id: 'ndfl_payment', title: 'Оплатить НДФЛ', rule: annual(7, 15) },
            ],
          },
        ]
      : [],
  };
}
export const TEMPLATES = [
  catalog('apartment', 'Квартира в многоквартирном доме'),
  catalog('rented_apartment', 'Сдаваемая квартира', false, true),
  catalog('house', 'Частный дом или дача', true),
];
export const ApplyTemplate = z
  .strictObject({
    idempotencyKey: z.uuid(),
    title: z.string().trim().min(1).max(200),
    propertyData: PropertyData.default({}),
    placement: z
      .strictObject({ spaceId: z.uuid(), audience: z.enum(['household', 'adults']).optional() })
      .optional(),
    householdId: z.uuid().optional(),
    accounts: z
      .array(
        z.strictObject({
          id: z.enum(UTILITY_SERVICES),
          title: z.string().trim().min(1).max(200).optional(),
          supplierId: z.uuid().optional(),
          data: UtilityAccountData.partial().optional(),
        }),
      )
      .max(20)
      .default([]),
    meters: z
      .array(
        z.strictObject({
          id: z.enum(['cold_water', 'hot_water', 'electricity', 'gas', 'heat']),
          data: MeterData.partial().optional(),
          initialReading: ReadingInput.optional(),
        }),
      )
      .max(5)
      .default([]),
    organizations: z
      .array(z.enum(['management', 'emergency']))
      .max(2)
      .default([]),
    deadlines: z
      .array(
        z.strictObject({
          id: z.enum(['property_tax', 'gas_service', 'tenant_readings']),
          rule: DeadlineRule.optional(),
        }),
      )
      .max(3)
      .default([]),
    taxRegime: z.enum(['npd', 'ndfl']).optional(),
  })
  .refine(
    (v) =>
      [v.accounts, v.meters, v.deadlines].every(
        (items) => new Set(items.map((i) => i.id)).size === items.length,
      ) && new Set(v.organizations).size === v.organizations.length,
  );
