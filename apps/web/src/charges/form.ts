import { chargeDueOn, type DeadlineRule } from '@homecrm/shared';
import { kopecksToInput, parseRubles } from '../objects/money.ts';
import type { ChargeInput, ChargeLine, Payer, PaymentInput, PaymentMethod } from './api.ts';

// Формы начисления и оплаты (UTIL-9, UTIL-10): чистые функции без React. Суммы вводятся в рублях
// с запятой («1 840,50»), разбираются строкой и уходят целыми копейками: ни parseFloat, ни Number
// на дробях. Предел одной суммы — как на сервере: 10¹² копеек.

export const MAX_CENTS = 1_000_000_000_000;
export const MAX_LINES = 100;
export const MAX_LINE_TITLE = 200;
export const MAX_REASON = 2000;

export type MoneyResult = { ok: true; cents: number } | { ok: false; error: string };

const MONEY_FORMAT =
  'Введите сумму в рублях: цифры и запятая, не больше двух знаков после запятой.';
const MONEY_RANGE = 'Сумма слишком большая: не больше 10 миллиардов рублей.';

/** Рубли из поля ввода → целые копейки. Пустое поле — ошибка «введите сумму». */
export function moneyOf(
  text: string,
  options: { negative?: boolean; positive?: boolean } = {},
): MoneyResult {
  const parsed = parseRubles(text);
  if (!parsed.ok) return { ok: false, error: MONEY_FORMAT };
  if (parsed.kopecks === null) return { ok: false, error: 'Введите сумму.' };
  if (Math.abs(parsed.kopecks) > MAX_CENTS) return { ok: false, error: MONEY_RANGE };
  if (parsed.kopecks < 0 && options.negative !== true) {
    return { ok: false, error: 'Сумма не может быть отрицательной.' };
  }
  if (options.positive === true && parsed.kopecks <= 0) {
    return { ok: false, error: 'Сумма должна быть больше нуля.' };
  }
  return { ok: true, cents: parsed.kopecks };
}

export { kopecksToInput };

// ---- Начисление

export interface LineDraft {
  /** Ключ строки в списке: порядок строк меняется, поля у них — нет. */
  key: number;
  title: string;
  amount: string;
  kind: ChargeLine['kind'];
}

export interface ChargeDraft {
  /** Расчётный месяц `YYYY-MM`. */
  period: string;
  /** Итог, когда строк нет; при строках итог — их сумма. */
  total: string;
  lines: LineDraft[];
  dueOn: string;
  receiptId: string;
}

export function emptyChargeDraft(period: string): ChargeDraft {
  return { period, total: '', lines: [], dueOn: '', receiptId: '' };
}

/** Расчётный месяц для нового начисления: предыдущий месяц от сегодняшнего дня дома. */
export function defaultPeriod(today: string): string {
  const [year = 1970, month = 1] = today.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${String(year).padStart(4, '0')}-${String(month - 1).padStart(2, '0')}`;
}

export interface ChargeErrors {
  period?: string;
  total?: string;
  dueOn?: string;
  lines: Record<number, { title?: string; amount?: string }>;
}

export type ChargeResult = { ok: true; input: ChargeInput } | { ok: false; errors: ChargeErrors };

/** Сумма строк, пока все они введены верно; иначе `null`. */
export function linesTotal(lines: readonly LineDraft[]): number | null {
  let total = 0;
  for (const line of lines) {
    const money = moneyOf(line.amount, { negative: line.kind === 'adjustment' });
    if (!money.ok) return null;
    total += money.cents;
  }
  return total;
}

/** Срок оплаты по правилу счёта; `null`, если правила нет. */
export function defaultDueOn(period: string, rule: DeadlineRule | null): string | null {
  return /^\d{4}-\d{2}$/.test(period) ? chargeDueOn(period, rule) : null;
}

export function toChargeInput(draft: ChargeDraft, rule: DeadlineRule | null): ChargeResult {
  const errors: ChargeErrors = { lines: {} };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.period)) {
    errors.period = 'Выберите расчётный месяц.';
  }

  const lines: ChargeLine[] = [];
  for (const line of draft.lines) {
    const problems: { title?: string; amount?: string } = {};
    const title = line.title.trim();
    if (title === '') problems.title = 'Назовите строку, например «Холодная вода».';
    else if (title.length > MAX_LINE_TITLE) problems.title = `Не длиннее ${MAX_LINE_TITLE} знаков.`;
    const money = moneyOf(line.amount, { negative: line.kind === 'adjustment' });
    if (!money.ok) problems.amount = money.error;
    if (problems.title !== undefined || problems.amount !== undefined) {
      errors.lines[line.key] = problems;
    } else if (money.ok) {
      lines.push({ title, amountCents: money.cents, kind: line.kind });
    }
  }

  let totalCents = 0;
  if (draft.lines.length > 0) {
    if (Object.keys(errors.lines).length === 0) {
      totalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
      if (totalCents < 0) errors.total = 'Итог не может быть отрицательным: проверьте перерасчёт.';
      else if (totalCents > MAX_CENTS) errors.total = MONEY_RANGE;
    }
  } else {
    const money = moneyOf(draft.total);
    if (money.ok) totalCents = money.cents;
    else errors.total = money.error;
  }

  const dueOn = draft.dueOn.trim();
  if (dueOn === '' && defaultDueOn(draft.period, rule) === null && errors.period === undefined) {
    errors.dueOn = 'Укажите срок оплаты: у лицевого счёта нет ежемесячного дня оплаты.';
  }

  if (
    errors.period !== undefined ||
    errors.total !== undefined ||
    errors.dueOn !== undefined ||
    Object.keys(errors.lines).length > 0
  ) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    input: {
      period: draft.period,
      totalCents,
      ...(lines.length > 0 ? { lines } : {}),
      ...(dueOn === '' ? {} : { dueOn }),
      ...(draft.receiptId === '' ? {} : { receiptId: draft.receiptId }),
    },
  };
}

// ---- Оплата

export interface PaymentDraft {
  paidOn: string;
  amount: string;
  /** `me`, `tenant` или `member:<id участника>`. */
  payer: string;
  method: PaymentMethod;
  receiptId: string;
}

export function paymentDraft(today: string, remainingCents: number): PaymentDraft {
  return {
    paidOn: today,
    amount: remainingCents > 0 ? kopecksToInput(remainingCents) : '',
    payer: 'me',
    method: 'card',
    receiptId: '',
  };
}

export interface PaymentErrors {
  paidOn?: string;
  amount?: string;
}

export type PaymentResult =
  | { ok: true; input: PaymentInput }
  | { ok: false; errors: PaymentErrors };

export function payerOf(value: string, meId: string): Payer {
  if (value === 'tenant') return { kind: 'tenant' };
  if (value.startsWith('member:')) return { kind: 'member', accountId: value.slice(7) };
  return { kind: 'member', accountId: meId };
}

export function toPaymentInput(draft: PaymentDraft, meId: string, today: string): PaymentResult {
  const errors: PaymentErrors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.paidOn)) errors.paidOn = 'Укажите дату оплаты.';
  else if (draft.paidOn > today) errors.paidOn = 'Дата оплаты не может быть позже сегодняшней.';
  const money = moneyOf(draft.amount, { positive: true });
  if (!money.ok) errors.amount = money.error;
  if (errors.paidOn !== undefined || !money.ok) return { ok: false, errors };
  return {
    ok: true,
    input: {
      paidOn: draft.paidOn,
      amountCents: money.cents,
      payer: payerOf(draft.payer, meId),
      method: draft.method,
      ...(draft.receiptId === '' ? {} : { receiptId: draft.receiptId }),
    },
  };
}

/** Причина отмены: обязательна, без пробелов по краям. */
export function reasonOf(
  text: string,
): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = text.trim();
  if (reason === '') return { ok: false, error: 'Напишите причину: она останется в истории.' };
  if (reason.length > MAX_REASON) {
    return { ok: false, error: `Причина не длиннее ${MAX_REASON} знаков.` };
  }
  return { ok: true, reason };
}
