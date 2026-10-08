import { AUDIENCES, PAYMENT_METHODS } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// Начисления и оплаты (UTIL-9, UTIL-10, ADR-0034, docs/templates-charges-api.md). Все суммы —
// целые копейки. Суммы, периоды, плательщики и причины живут только в ответах и памяти страницы:
// в адреса, журнал, localStorage и кэш сервис-воркера они не попадают.

export const ChargeLine = z.object({
  title: z.string(),
  amountCents: z.number().int(),
  kind: z.enum(['service', 'adjustment']),
});
export type ChargeLine = z.infer<typeof ChargeLine>;

const Placed = {
  id: z.string(),
  title: z.string(),
  parentId: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
};

export const Charge = z.object({
  ...Placed,
  /** Расчётный месяц: `2026-10`. */
  period: z.string(),
  totalCents: z.number().int(),
  lines: z.array(ChargeLine).default([]),
  /** Срок оплаты: `YYYY-MM-DD`. */
  dueOn: z.string(),
  cancelledAt: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  receiptIds: z.array(z.string()).default([]),
});
export type Charge = z.infer<typeof Charge>;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const Payer = z.union([
  z.object({ kind: z.literal('member'), accountId: z.string() }),
  z.object({ kind: z.literal('tenant') }),
]);
export type Payer = z.infer<typeof Payer>;

export const Payment = z.object({
  ...Placed,
  paidOn: z.string(),
  amountCents: z.number().int(),
  payer: Payer,
  method: z.enum(PAYMENT_METHODS),
  cancelledAt: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  receiptIds: z.array(z.string()).default([]),
});
export type Payment = z.infer<typeof Payment>;

export interface ChargeInput {
  period: string;
  totalCents: number;
  lines?: ChargeLine[];
  dueOn?: string;
  receiptId?: string | null;
}

export interface PaymentInput {
  paidOn: string;
  amountCents: number;
  payer: Payer;
  method: PaymentMethod;
  receiptId?: string | null;
}

export const PAGE_SIZE = 100;

export function fetchCharges(accountId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' });
  return apiRequest(
    'GET',
    `accounts/${accountId}/charges?${query}`,
    z.array(Charge),
    undefined,
    signal,
  );
}

export function createCharge(accountId: string, input: ChargeInput) {
  return apiRequest('POST', `accounts/${accountId}/charges`, Charge, input);
}

export function cancelCharge(chargeId: string, reason: string) {
  return apiRequest('POST', `charges/${chargeId}/cancel`, Charge, { reason });
}

export function fetchPayments(chargeId: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' });
  return apiRequest(
    'GET',
    `charges/${chargeId}/payments?${query}`,
    z.array(Payment),
    undefined,
    signal,
  );
}

export function createPayment(chargeId: string, input: PaymentInput) {
  return apiRequest('POST', `charges/${chargeId}/payments`, Payment, input);
}

export function cancelPayment(paymentId: string, reason: string) {
  return apiRequest('POST', `payments/${paymentId}/cancel`, Payment, { reason });
}
