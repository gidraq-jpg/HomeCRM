import { expect, it } from 'vitest';
import { matchReceiptAccount, parsePaymentQr, receiptKopecks, receiptPeriod } from './receipt.ts';

const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

it.each([
  ['1 234,56', 123456],
  ['0,01', 1],
  ['9.9', 990],
  ['500 ₽', 50000],
  ['10 000 000 000,00', 1_000_000_000_000],
  ['10 000 000 000,01', null],
  ['-1', null],
  ['1.234', null],
  ['1e3', null],
  ['12,34,56', null],
  [null, null],
])('UTIL-9: сумма %s → точные копейки', (value, expected) =>
  expect(receiptKopecks(value)).toBe(expected),
);
it('UTIL-9: QR сумма уже в копейках; PersAcc важнее банковского PersonalAcc', () => {
  expect(
    parsePaymentQr(
      'ST00012|Name=Учебная вода|PersonalAcc=00000000000000000000|PersAcc=TEST-777|Sum=123456|PaymPeriod=092026|Purpose=Услуги',
    ),
  ).toEqual({
    supplier: 'Учебная вода',
    accountNumber: 'TEST-777',
    totalCents: 123456,
    period: '2026-09',
    purpose: 'Услуги',
  });
});
it('UTIL-9: UTF-8, Windows-1251, KOI8-R', () => {
  expect(
    parsePaymentQr(
      new Uint8Array([
        ...ascii('ST00012|Name='),
        0xd0,
        0x92,
        0xd0,
        0xbe,
        0xd0,
        0xb4,
        0xd0,
        0xb0,
        ...ascii('|Sum=7'),
      ]),
    )?.supplier,
  ).toBe('Вода');
  for (const [header, name] of [
    ['ST00011|Name=', [0xc2, 0xee, 0xe4, 0xe0]],
    ['ST00013|Name=', [0xf7, 0xcf, 0xc4, 0xc1]],
  ] as const) {
    const bytes = new Uint8Array([...ascii(header), ...name, ...ascii('|Sum=7')]);
    expect(parsePaymentQr(bytes)?.supplier).toBe('Вода');
    expect(parsePaymentQr(bytes)?.totalCents).toBe(7);
  }
});
it('UTIL-9: неполный QR оставляет известное и не выдумывает сумму/период', () => {
  expect(parsePaymentQr('ST00012|PersonalAcc=TEST-777')).toMatchObject({
    accountNumber: 'TEST-777',
    totalCents: null,
    period: null,
  });
  expect(parsePaymentQr('ST00012|Name=Учебное|Sum=-5')?.totalCents).toBe(null);
});
it.each([
  'https://fiction.test',
  'ST00014|Name=Вода',
  'ST00012|',
  'ST00012|Sum=1|Sum=2',
  'ST00012|Name',
  `ST00012|Name=${String.fromCodePoint(0xfffd)}`,
])('UTIL-9: чужой/повреждённый QR отклоняется: %s', (value) =>
  expect(parsePaymentQr(value)).toBe(null),
);
it.each([
  ['2026-09', '2026-09'],
  ['092026', '2026-09'],
  ['Услуги за 09.2026', '2026-09'],
  ['132026', null],
])('UTIL-9: период %s', (value, expected) => expect(receiptPeriod(value)).toBe(expected));
it('UTIL-9: счёт только из переданного видимого списка, неоднозначность требует выбора', () => {
  const accounts = [{ id: 'visible', number: 'TEST-777' }];
  expect(matchReceiptAccount('TEST-777', accounts)).toBe('visible');
  expect(matchReceiptAccount('SECRET-111', accounts)).toBe(null);
  expect(
    matchReceiptAccount('TEST-777', [...accounts, { id: 'duplicate', number: 'TEST-777' }]),
  ).toBe(null);
});
