import { DeadlineRule } from '@homecrm/shared';
import { describe, expect, it } from 'vitest';
import {
  defaultDueOn,
  defaultPeriod,
  emptyChargeDraft,
  linesTotal,
  moneyOf,
  payerOf,
  paymentDraft,
  reasonOf,
  toChargeInput,
  toPaymentInput,
} from './form.ts';
import { chargeStatus, overpaidCents, periodLabel } from './labels.ts';

const RULE = DeadlineRule.parse({
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: 15 },
  warnings: [3, 0],
  warningTime: '09:00',
});

describe('сумма в рублях → копейки', () => {
  it('запятая, пробелы тысяч и точка дают точные копейки', () => {
    expect(moneyOf('1 840,50')).toEqual({ ok: true, cents: 184_050 });
    expect(moneyOf('1840.5')).toEqual({ ok: true, cents: 184_050 });
    expect(moneyOf('0,29')).toEqual({ ok: true, cents: 29 });
    expect(moneyOf('19,99')).toEqual({ ok: true, cents: 1999 });
  });

  it('отрицательная сумма допустима только для перерасчёта', () => {
    expect(moneyOf('-120')).toEqual({ ok: false, error: 'Сумма не может быть отрицательной.' });
    expect(moneyOf('-120', { negative: true })).toEqual({ ok: true, cents: -12_000 });
  });

  it('пустое, нулевое для оплаты, дробное и слишком большое не проходят', () => {
    expect(moneyOf('').ok).toBe(false);
    expect(moneyOf('0', { positive: true }).ok).toBe(false);
    expect(moneyOf('12,345').ok).toBe(false);
    expect(moneyOf('abc').ok).toBe(false);
    expect(moneyOf('10 000 000 001').ok).toBe(false);
    expect(moneyOf('10 000 000 000')).toEqual({ ok: true, cents: 1_000_000_000_000 });
  });
});

describe('расчётный месяц и срок', () => {
  it('новое начисление — за прошлый месяц', () => {
    expect(defaultPeriod('2026-10-08')).toBe('2026-09');
    expect(defaultPeriod('2026-01-03')).toBe('2025-12');
  });

  it('срок по правилу счёта — следующий месяц, а без правила его нет', () => {
    expect(defaultDueOn('2026-10', RULE)).toBe('2026-11-15');
    expect(defaultDueOn('2026-10', null)).toBeNull();
    expect(defaultDueOn('', RULE)).toBeNull();
  });

  it('месяц словами', () => {
    expect(periodLabel('2026-10')).toBe('Октябрь 2026');
    expect(periodLabel('2026-13')).toBe('2026-13');
  });
});

describe('форма начисления', () => {
  it('одного итога достаточно; копейки целые', () => {
    const result = toChargeInput({ ...emptyChargeDraft('2026-10'), total: '1 840,50' }, RULE);
    expect(result).toEqual({ ok: true, input: { period: '2026-10', totalCents: 184_050 } });
  });

  it('итог считается из строк, перерасчёт идёт со знаком', () => {
    const draft = {
      ...emptyChargeDraft('2026-10'),
      dueOn: '2026-11-20',
      lines: [
        { key: 1, title: 'Холодная вода', amount: '500,25', kind: 'service' as const },
        { key: 2, title: 'Электроэнергия', amount: '1 000', kind: 'service' as const },
        { key: 3, title: 'Перерасчёт воды', amount: '-100,10', kind: 'adjustment' as const },
      ],
    };
    expect(linesTotal(draft.lines)).toBe(140_015);
    expect(toChargeInput(draft, null)).toEqual({
      ok: true,
      input: {
        period: '2026-10',
        totalCents: 140_015,
        dueOn: '2026-11-20',
        lines: [
          { title: 'Холодная вода', amountCents: 50_025, kind: 'service' },
          { title: 'Электроэнергия', amountCents: 100_000, kind: 'service' },
          { title: 'Перерасчёт воды', amountCents: -10_010, kind: 'adjustment' },
        ],
      },
    });
  });

  it('итог не может стать отрицательным, строка услуги — тоже', () => {
    const negative = toChargeInput(
      {
        ...emptyChargeDraft('2026-10'),
        lines: [{ key: 1, title: 'Возврат', amount: '-5', kind: 'adjustment' }],
      },
      RULE,
    );
    expect(negative.ok).toBe(false);
    const service = toChargeInput(
      {
        ...emptyChargeDraft('2026-10'),
        lines: [{ key: 1, title: 'Вода', amount: '-5', kind: 'service' }],
      },
      RULE,
    );
    expect(service.ok).toBe(false);
  });

  it('без дня оплаты у счёта срок обязателен', () => {
    const result = toChargeInput({ ...emptyChargeDraft('2026-10'), total: '100' }, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.dueOn).toContain('срок оплаты');
  });

  it('квитанция уходит идентификатором файла', () => {
    const result = toChargeInput(
      { ...emptyChargeDraft('2026-10'), total: '100', receiptId: 'file-1' },
      RULE,
    );
    expect(result).toEqual({
      ok: true,
      input: { period: '2026-10', totalCents: 10_000, receiptId: 'file-1' },
    });
  });
});

describe('форма оплаты', () => {
  it('по умолчанию — остаток начисления, плательщик «я», способ «картой»', () => {
    expect(paymentDraft('2026-10-08', 184_050)).toEqual({
      paidOn: '2026-10-08',
      amount: '1840,50',
      payer: 'me',
      method: 'card',
      receiptId: '',
    });
  });

  it('копейки целые, дата не позже сегодняшней, сумма положительна', () => {
    const draft = { ...paymentDraft('2026-10-08', 0), amount: '400' };
    expect(toPaymentInput(draft, 'me-id', '2026-10-08')).toEqual({
      ok: true,
      input: {
        paidOn: '2026-10-08',
        amountCents: 40_000,
        payer: { kind: 'member', accountId: 'me-id' },
        method: 'card',
      },
    });
    expect(toPaymentInput({ ...draft, paidOn: '2026-10-09' }, 'me-id', '2026-10-08').ok).toBe(
      false,
    );
    expect(toPaymentInput({ ...draft, amount: '0' }, 'me-id', '2026-10-08').ok).toBe(false);
  });

  it('плательщик: я, другой участник, арендатор', () => {
    expect(payerOf('me', 'a')).toEqual({ kind: 'member', accountId: 'a' });
    expect(payerOf('member:b', 'a')).toEqual({ kind: 'member', accountId: 'b' });
    expect(payerOf('tenant', 'a')).toEqual({ kind: 'tenant' });
  });

  it('причина отмены обязательна', () => {
    expect(reasonOf('   ').ok).toBe(false);
    expect(reasonOf('  Ошибка суммы ')).toEqual({ ok: true, reason: 'Ошибка суммы' });
  });
});

describe('статус начисления', () => {
  const base = { totalCents: 100_000, cancelledAt: null };
  it('к оплате, частично, оплачено, отменено', () => {
    expect(chargeStatus({ ...base, paidCents: 0 })).toBe('due');
    expect(chargeStatus({ ...base, paidCents: 40_000 })).toBe('partial');
    expect(chargeStatus({ ...base, paidCents: 100_000 })).toBe('paid');
    expect(chargeStatus({ ...base, paidCents: 0, cancelledAt: '2026-10-08T00:00:00Z' })).toBe(
      'cancelled',
    );
  });

  it('нулевой итог закрыт сразу, переплата тоже оплата', () => {
    expect(chargeStatus({ totalCents: 0, paidCents: 0, cancelledAt: null })).toBe('paid');
    expect(chargeStatus({ ...base, paidCents: 120_000 })).toBe('paid');
    expect(overpaidCents({ ...base, paidCents: 120_000 })).toBe(20_000);
    expect(overpaidCents({ ...base, paidCents: 50_000 })).toBe(0);
  });
});
