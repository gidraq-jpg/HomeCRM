import { expect, it } from 'vitest';
import { ChargeInput, chargeDueOn, PaymentInput } from './charges.ts';
import { DeadlineRule } from './deadlines.ts';

it('UTIL-9: следующий месяц, короткий февраль и смена года без дрейфа', () => {
  const rule = DeadlineRule.parse({
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day: 31 },
  });
  expect(chargeDueOn('2026-01', rule)).toBe('2026-02-28');
  expect(chargeDueOn('2028-01', rule)).toBe('2028-02-29');
  expect(chargeDueOn('2026-12', rule)).toBe('2027-01-31');
  expect(chargeDueOn('2026-12', null)).toBeNull();
});
it('UTIL-9/10: целые копейки и точная сумма знаковых строк', () => {
  expect(ChargeInput.safeParse({ period: '2026-10', totalCents: 1.23 }).success).toBe(false);
  expect(ChargeInput.safeParse({ period: '2026-13', totalCents: 123 }).success).toBe(false);
  expect(
    ChargeInput.safeParse({
      period: '2026-10',
      totalCents: 999999999999,
      lines: [
        { title: 'Услуга', amountCents: 1000000000000 },
        { title: 'Перерасчёт', kind: 'adjustment', amountCents: -1 },
      ],
    }).success,
  ).toBe(true);
  expect(
    ChargeInput.safeParse({
      period: '2026-10',
      totalCents: 1,
      lines: [{ title: 'Услуга', amountCents: 2 }],
    }).success,
  ).toBe(false);
  for (const amountCents of [0, -1, 1.5, 1000000000001])
    expect(
      PaymentInput.safeParse({
        paidOn: '2026-10-08',
        amountCents,
        payer: { kind: 'tenant' },
        method: 'tenant',
      }).success,
    ).toBe(false);
});
