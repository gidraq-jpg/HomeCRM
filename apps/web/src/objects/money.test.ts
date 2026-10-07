import { describe, expect, it } from 'vitest';
import { kopecksToInput, parseRubles } from './money.ts';

describe('сумма события в рублях', () => {
  it('пустое поле — суммы нет', () => {
    expect(parseRubles('')).toEqual({ ok: true, kopecks: null });
    expect(parseRubles('   ')).toEqual({ ok: true, kopecks: null });
  });

  it('принимает запятую и точку, пробелы между тысячами', () => {
    expect(parseRubles('3500')).toEqual({ ok: true, kopecks: 350_000 });
    expect(parseRubles('1 840,50')).toEqual({ ok: true, kopecks: 184_050 });
    expect(parseRubles('1840.5')).toEqual({ ok: true, kopecks: 184_050 });
    expect(parseRubles('0,07')).toEqual({ ok: true, kopecks: 7 });
  });

  it('считает копейки целыми, без ошибок плавающей точки', () => {
    expect(parseRubles('0,29')).toEqual({ ok: true, kopecks: 29 });
    expect(parseRubles('1,15')).toEqual({ ok: true, kopecks: 115 });
    expect(parseRubles('19,99')).toEqual({ ok: true, kopecks: 1999 });
  });

  it('знак «минус» — обычный и типографский', () => {
    expect(parseRubles('-250')).toEqual({ ok: true, kopecks: -25_000 });
    expect(parseRubles(`${String.fromCodePoint(0x2212)}250,5`)).toEqual({
      ok: true,
      kopecks: -25_050,
    });
  });

  it('отклоняет буквы, три знака после запятой и слишком большие суммы', () => {
    for (const bad of ['abc', '12,345', '1,2,3', '12 р', '--5', '99999999999999999']) {
      expect(parseRubles(bad), bad).toEqual({ ok: false });
    }
  });

  it('копейки → строка для поля ввода', () => {
    expect(kopecksToInput(350_000)).toBe('3500');
    expect(kopecksToInput(184_050)).toBe('1840,50');
    expect(kopecksToInput(7)).toBe('0,07');
    expect(kopecksToInput(-25_000)).toBe('-250');
  });
});
