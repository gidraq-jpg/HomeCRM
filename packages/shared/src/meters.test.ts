import { expect, it } from 'vitest';
import {
  consumptionWarning,
  MeterData,
  meterUnits,
  readingConsumption,
  resolveMeterData,
} from './meters.ts';

it.each([
  [3, 0, '999', '2', '3'],
  [5, 3, '99999.999', '0.001', '0.002'],
  [12, 6, '999999999999.999999', '0.000001', '0.000002'],
])(
  'переход через ноль: %s целых и %s дробных разрядов',
  (integerDigits, fractionDigits, before, after, expected) => {
    const data = MeterData.parse({ resource: 'cold_water', integerDigits, fractionDigits });
    expect(readingConsumption(data, [String(after)], [String(before)], true)).toEqual([expected]);
    expect(() => readingConsumption(data, [String(after)], [String(before)])).toThrow();
  },
);
it('точность выше безопасного Number, запятая, дробные разряды и три зоны', () => {
  const data = MeterData.parse({
    resource: 'electricity',
    integerDigits: 12,
    fractionDigits: 6,
    zones: ['День', 'Ночь', 'Пик'],
  });
  expect(
    readingConsumption(
      data,
      ['999999999999,000002', '2.000001', '3'],
      ['999999999999.000001', '2', '2.5'],
    ),
  ).toEqual(['0.000001', '0.000001', '0.500000']);
  expect(() => meterUnits('1.0000001', data)).toThrow();
  expect(() => readingConsumption(data, ['1'], null)).toThrow();
});
it('аномалия включает точный порог 40%, доступную историю и нулевой средний расход', () => {
  expect(
    consumptionWarning(
      ['1.399'],
      Array.from({ length: 6 }, () => ['1.000']),
      3,
    ),
  ).toEqual([]);
  expect(
    consumptionWarning(
      ['1.400'],
      Array.from({ length: 6 }, () => ['1.000']),
      3,
    ),
  ).toHaveLength(1);
  expect(consumptionWarning(['1.400'], [['1.000']], 3)).toHaveLength(1);
  expect(consumptionWarning(['1.400'], [], 3)).toEqual([]);
  expect(consumptionWarning(null, [], 3)).toEqual([]);
  expect(consumptionWarning(['0.000'], [['0.000']], 3)).toEqual([]);
  expect(consumptionWarning(['0.001'], [['0.000']], 3)).toHaveLength(1);
});
it('поверка из приложения А, високосный день и ручная дата', () => {
  const meter = MeterData.parse({ resource: 'hot_water', verifiedOn: '2024-02-29' });
  expect(resolveMeterData(meter).nextVerificationOn).toBe('2028-02-29');
  expect(resolveMeterData({ ...meter, verificationYears: 1 }).nextVerificationOn).toBe(
    '2025-02-28',
  );
  expect(
    resolveMeterData(MeterData.parse({ ...meter, nextVerificationOn: '2029-01-01' }))
      .nextVerificationOn,
  ).toBe('2029-01-01');
  expect(resolveMeterData(MeterData.parse({ resource: 'electricity' })).verificationYears).toBe(16);
});
