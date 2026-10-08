import { z } from 'zod';
import { CalendarDate } from './deadlines.ts';

export const METER_RESOURCES = ['cold_water', 'hot_water', 'electricity', 'gas', 'heat'] as const;
export const VERIFICATION_YEARS = {
  cold_water: 6,
  hot_water: 4,
  electricity: 16,
  gas: 10,
  heat: 4,
} as const;
export const DecimalValue = z
  .string()
  .regex(/^\d{1,18}([.,]\d{1,6})?$/)
  .transform((v) => v.replace(',', '.'));
export const MeterData = z.strictObject({
  resource: z.enum(METER_RESOURCES),
  model: z.string().trim().max(200).default(''),
  serialNumber: z.string().trim().max(200).default(''),
  installationPlace: z.string().trim().max(200).default(''),
  zones: z.array(z.string().trim().min(1).max(100)).min(1).max(3).default(['Основная']),
  integerDigits: z.number().int().min(1).max(12).default(5),
  fractionDigits: z.number().int().min(0).max(6).default(3),
  unit: z.string().trim().min(1).max(30).optional(),
  installedOn: CalendarDate.nullable().default(null),
  verifiedOn: CalendarDate.nullable().default(null),
  verificationYears: z.number().int().min(1).max(50).optional(),
  nextVerificationOn: CalendarDate.nullable().optional(),
  verificationWarnings: z.array(z.number().int().min(0).max(365)).max(20).optional(),
  verificationWarningTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  status: z.enum(['active', 'replaced', 'removed']).default('active'),
});
export type MeterData = z.infer<typeof MeterData>;
export const ReadingInput = z.strictObject({
  occurredOn: CalendarDate,
  values: z.array(DecimalValue).min(1).max(3),
  rollover: z.boolean().default(false),
  comment: z.string().max(10000).default(''),
  photoIds: z
    .array(z.uuid())
    .max(10)
    .refine((ids) => new Set(ids).size === ids.length)
    .default([]),
});
export type ReadingInput = z.infer<typeof ReadingInput>;
export function resolveMeterData(input: MeterData): MeterData {
  const data = MeterData.parse(input);
  const years = data.verificationYears ?? VERIFICATION_YEARS[data.resource];
  let calculated: CalendarDate | null = null;
  if (data.verifiedOn) {
    const [year, month, day] = data.verifiedOn.split('-').map(Number) as [number, number, number];
    const last = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
    calculated = CalendarDate.parse(
      `${year + years}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`,
    );
  }
  return {
    ...data,
    verificationYears: years,
    unit:
      data.unit ??
      (data.resource === 'electricity' ? 'кВт·ч' : data.resource === 'heat' ? 'Гкал' : 'м³'),
    nextVerificationOn:
      data.nextVerificationOn === undefined ? calculated : data.nextVerificationOn,
  };
}
/** Точные минимальные доли: Number для значений и расхода не используется. */
export function meterUnits(
  value: string,
  data: Pick<MeterData, 'integerDigits' | 'fractionDigits'>,
): bigint {
  const [integer, fraction = ''] = DecimalValue.parse(value).split('.') as [string, string?];
  if (fraction.length > data.fractionDigits || BigInt(integer) >= 10n ** BigInt(data.integerDigits))
    throw new RangeError('Invalid meter precision');
  return (
    BigInt(integer) * 10n ** BigInt(data.fractionDigits) +
    BigInt(fraction.padEnd(data.fractionDigits, '0') || '0')
  );
}
export function meterDecimal(units: bigint, fractionDigits: number): string {
  const raw = units.toString().padStart(fractionDigits + 1, '0');
  return fractionDigits ? `${raw.slice(0, -fractionDigits)}.${raw.slice(-fractionDigits)}` : raw;
}
export function readingConsumption(
  data: MeterData,
  values: string[],
  previous: string[] | null,
  rollover = false,
): string[] | null {
  if (values.length !== data.zones.length || (previous && previous.length !== values.length))
    throw new RangeError('Invalid zones');
  const current = values.map((v) => meterUnits(v, data));
  if (!previous) return null;
  return current.map((value, i) => {
    const before = meterUnits(previous[i] as string, data);
    if (value < before && !rollover) throw new RangeError('Reading decreased');
    const delta =
      value >= before
        ? value - before
        : 10n ** BigInt(data.integerDigits + data.fractionDigits) - before + value;
    return meterDecimal(delta, data.fractionDigits);
  });
}
export const CONSUMPTION_WARNING = 'Проверьте, нет ли утечки или ошибки';
export function consumptionWarning(
  current: string[] | null,
  history: string[][],
  fractionDigits: number,
): string[] {
  if (!current || !history.length) return [];
  const scale = Math.max(
    fractionDigits,
    ...[...current, ...history.flat()].map((v) => v.split('.')[1]?.length ?? 0),
  );
  const units = (v: string) =>
    BigInt(v.replace('.', '')) * 10n ** BigInt(scale - (v.split('.')[1]?.length ?? 0));
  const abnormal = current.some((value, i) => {
    const total = history.reduce((sum, row) => sum + units(row[i] as string), 0n);
    return units(value) > 0n && units(value) * BigInt(history.length) * 10n >= total * 14n;
  });
  return abnormal ? [CONSUMPTION_WARNING] : [];
}
