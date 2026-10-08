import type { PaymentMethod } from './api.ts';

// Подписи начислений и оплат (PRD, раздел 13): русские названия месяцев, статусы и способы оплаты.

const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
] as const;

/** Расчётный месяц словами: `2026-10` → «Октябрь 2026». */
export function periodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? period : `${month} ${match[1]}`;
}

export const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  card: 'Картой',
  autopay: 'Автоплатёж',
  gosuslugi: 'Через Госуслуги',
  cash: 'Наличными',
  tenant: 'Оплатил арендатор',
};

export const METHOD_ORDER: readonly PaymentMethod[] = [
  'card',
  'autopay',
  'gosuslugi',
  'cash',
  'tenant',
];

export type ChargeStatus = 'due' | 'partial' | 'paid' | 'cancelled';

export const STATUS_LABELS: Readonly<Record<ChargeStatus, string>> = {
  due: 'К оплате',
  partial: 'Частично',
  paid: 'Оплачено',
  cancelled: 'Отменено',
};

export interface StatusFacts {
  totalCents: number;
  paidCents: number;
  cancelledAt: string | null;
}

/**
 * Статус начисления: «к оплате», «частично», «оплачено» (UTIL-10). Нулевой итог закрыт сразу,
 * как на сервере; переплата тоже считается оплатой.
 */
export function chargeStatus(charge: StatusFacts): ChargeStatus {
  if (charge.cancelledAt !== null) return 'cancelled';
  if (charge.paidCents >= charge.totalCents) return 'paid';
  return charge.paidCents > 0 ? 'partial' : 'due';
}

/** Сколько заплачено сверх итога; 0, если переплаты нет. */
export function overpaidCents(charge: Pick<StatusFacts, 'totalCents' | 'paidCents'>): number {
  return Math.max(0, charge.paidCents - charge.totalCents);
}
