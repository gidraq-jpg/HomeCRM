import { describe, expect, it } from 'vitest';
import {
  checkZone,
  fromUnits,
  normalizeDecimal,
  problemText,
  showDecimal,
  toUnits,
} from './decimal.ts';

const DIGITS = { integerDigits: 5, fractionDigits: 3 };

describe('десятичные значения счётчиков', () => {
  it('запятая и точка равны, лишнее отбрасывается', () => {
    expect(normalizeDecimal('123,4')).toBe('123.4');
    expect(normalizeDecimal(' 123.4 ')).toBe('123.4');
    expect(normalizeDecimal('12,')).toBe('12');
    expect(normalizeDecimal(',5')).toBe('0.5');
    expect(normalizeDecimal('007')).toBe('7');
    for (const bad of ['', 'abc', '-1', '1,2,3', '1e3', '.'])
      expect(normalizeDecimal(bad), bad).toBeNull();
  });

  it('доли считаются точно, без чисел с плавающей точкой', () => {
    expect(toUnits('100.125', 3)).toBe(100_125n);
    expect(toUnits('7', 3)).toBe(7000n);
    expect(toUnits('0.1', 3)).toBe(100n);
    expect(toUnits('0.1234', 3)).toBeNull();
    expect(fromUnits(100_125n, 3)).toBe('100.125');
    expect(fromUnits(5n, 3)).toBe('0.005');
    expect(fromUnits(42n, 0)).toBe('42');
    expect(showDecimal('100.125')).toBe('100,125');
  });
});

describe('проверка значения зоны', () => {
  it('расход считается от прошлого показания точно', () => {
    expect(checkZone(DIGITS, '110,125', '100.125', false)).toEqual({
      status: 'ok',
      value: '110.125',
      consumption: '10.000',
    });
    expect(checkZone(DIGITS, '0,3', '0.1', false)).toEqual({
      status: 'ok',
      value: '0.300',
      consumption: '0.200',
    });
    expect(checkZone(DIGITS, '5', null, false)).toEqual({
      status: 'ok',
      value: '5.000',
      consumption: null,
    });
  });

  it('пустое — не введено; мусор, лишние знаки и лишние разряды отклоняются', () => {
    expect(checkZone(DIGITS, '  ', '1.000', false)).toEqual({ status: 'empty' });
    const format = checkZone(DIGITS, 'много', null, false);
    expect(format.status === 'invalid' && problemText(format.problem, DIGITS)).toContain('цифры');
    const precision = checkZone(DIGITS, '1,2345', null, false);
    expect(precision.status === 'invalid' && problemText(precision.problem, DIGITS)).toContain(
      'не больше 3',
    );
    const range = checkZone(DIGITS, '123456', null, false);
    expect(range.status === 'invalid' && problemText(range.problem, DIGITS)).toContain('5 цифр');
    const whole = checkZone({ integerDigits: 6, fractionDigits: 0 }, '1,5', null, false);
    expect(whole.status === 'invalid' && problemText(whole.problem, DIGITS)).toBeDefined();
  });

  it('меньше прошлого — ошибка «Меньше прошлого: 123,400», пока не выбран переход через ноль', () => {
    const lower = checkZone(DIGITS, '100', '123.400', false);
    expect(lower.status).toBe('invalid');
    expect(lower.status === 'invalid' && problemText(lower.problem, DIGITS)).toBe(
      'Меньше прошлого: 123,400',
    );
    // 99999,000 → 5,000: до нуля 1,000 и ещё 5,000.
    expect(checkZone(DIGITS, '5', '99999.000', true)).toEqual({
      status: 'ok',
      value: '5.000',
      consumption: '6.000',
    });
  });
});
