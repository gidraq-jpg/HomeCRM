import { describe, expect, it } from 'vitest';
import { deadlineOccurrences } from './deadlines.ts';
import { OrganizationData, PropertyData, UtilityAccountData } from './utilities.ts';

it('UTIL-1: пустые старые поля валидны; площадь хранится в целых сотых', () => {
  expect(PropertyData.parse({})).toEqual({});
  expect(PropertyData.parse({ areaHundredths: 5731 }).areaHundredths).toBe(5731);
  for (const value of [57.31, -1, Number.MAX_SAFE_INTEGER + 1])
    expect(PropertyData.safeParse({ areaHundredths: value }).success).toBe(false);
});
it('UTIL-1: кадастровый номер имеет четыре части установленного формата', () => {
  for (const value of ['66:41:0101001:123', '77:01:000401:7'])
    expect(PropertyData.safeParse({ cadastralNumber: value }).success).toBe(true);
  for (const value of [
    '66-41-0101001-123',
    '6:41:0101001:123',
    '66:41:123:1',
    '66:41:0101001:123 extra',
  ])
    expect(PropertyData.safeParse({ cadastralNumber: value }).success).toBe(false);
});
it('CONT-2: проверяет тип, аварийные телефоны и безопасные ссылки', () => {
  expect(
    OrganizationData.parse({ phones: [{ number: '+7 000 123-45-67', emergency: true }] }).phones[0]
      ?.emergency,
  ).toBe(true);
  expect(OrganizationData.safeParse({ organizationType: 'unknown' }).success).toBe(false);
  expect(OrganizationData.safeParse({ website: 'javascript:alert(1)' }).success).toBe(false);
});
it('UTIL-2: закрытый список услуг и способы передачи', () => {
  expect(UtilityAccountData.parse({}).number).toBe('');
  for (const data of [
    { services: ['unknown'] },
    { services: ['water_sewerage', 'water_sewerage'] },
    { transmission: { method: 'provider' } },
    { transmission: { method: 'phone', phone: '' } },
  ])
    expect(UtilityAccountData.safeParse(data).success).toBe(false);
});
describe.each([
  ['2026-01-28', '2026-02-05'],
  ['2026-02-28', '2026-03-05'],
  ['2026-12-28', '2027-01-05'],
])('DEAD-1: окно через месяц от %s', (start, end) => {
  it('сохраняет календарные дни, независимо от длины месяца', () => {
    const data = UtilityAccountData.parse({
      readingRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'month', day: 28, endDay: 5 },
      },
    });
    if (!data.readingRule) throw Error('Missing rule');
    const [occurrence] = deadlineOccurrences(
      data.readingRule,
      new Date(`${start}T00:00:00Z`),
      'UTC',
      0,
    );
    expect(occurrence?.date).toBe(start);
    expect(occurrence?.endsAt.toISOString()).toBe(`${end}T23:59:59.999Z`);
  });
});
it('UTIL-2: срок оплаты — ежемесячная дата, без окна', () => {
  expect(
    UtilityAccountData.safeParse({ paymentRule: { kind: 'date', date: '2026-10-15' } }).success,
  ).toBe(false);
  expect(
    UtilityAccountData.safeParse({
      paymentRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'month', day: 15, endDay: 20 },
      },
    }).success,
  ).toBe(false);
});
