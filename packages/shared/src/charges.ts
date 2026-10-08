import { z } from 'zod';
import { CalendarDate, type DeadlineRule } from './deadlines.ts';

// Ограничение оставляет запас для суммирования в безопасном целочисленном диапазоне JS.
export const Cents = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const BillingPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const ChargeLine = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    amountCents: Cents,
    kind: z.enum(['service', 'adjustment']).default('service'),
  })
  .refine((line) => line.kind === 'adjustment' || line.amountCents >= 0, {
    path: ['amountCents'],
  });
export const ChargeInput = z
  .strictObject({
    period: BillingPeriod,
    totalCents: Cents.nonnegative(),
    lines: z.array(ChargeLine).max(100).default([]),
    dueOn: CalendarDate.optional(),
    receiptId: z.uuid().nullable().default(null),
  })
  .refine(
    (v) =>
      !v.lines.length ||
      v.lines.reduce((n, l) => n + BigInt(l.amountCents), 0n) === BigInt(v.totalCents),
  );
export type ChargeLine = z.infer<typeof ChargeLine>;
export const PAYMENT_METHODS = ['card', 'autopay', 'gosuslugi', 'cash', 'tenant'] as const;
export const PaymentInput = z.strictObject({
  paidOn: CalendarDate,
  amountCents: Cents.positive(),
  payer: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('member'), accountId: z.uuid() }),
    z.strictObject({ kind: z.literal('tenant') }),
  ]),
  method: z.enum(PAYMENT_METHODS),
  receiptId: z.uuid().nullable().default(null),
});
export type PaymentInput = z.infer<typeof PaymentInput>;
export const CancellationInput = z.strictObject({ reason: z.string().trim().min(1).max(2000) });
/** Расчётный месяц оплачивается в следующем; 31-е ограничивается последним днём. */
export function chargeDueOn(period: string, rule: DeadlineRule | null): string | null {
  if (rule?.kind !== 'repeat' || rule.repeat.unit !== 'month') return null;
  const [year, month] = period.split('-').map(Number) as [number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month, 1);
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  const day = Math.min(rule.repeat.day, last.getUTCDate());
  const result = CalendarDate.safeParse(
    `${date.toISOString().slice(0, 7)}-${String(day).padStart(2, '0')}`,
  );
  return result.success ? result.data : null;
}
