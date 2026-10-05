import { describe, expect, it } from 'vitest';
import {
  addDays,
  countWord,
  type DateOnly,
  daysBetween,
  formatDecimal,
  formatLongDate,
  formatRelativeDays,
  formatRub,
  formatShortDate,
  normalizeText,
  parseDecimal,
  plural,
  toTelHref,
  weekdayName,
} from './format.ts';

const NBSP = String.fromCodePoint(0xa0);
const asText = (value: string) => value.replaceAll(NBSP, ' ');

describe('plural', () => {
  const days = ['день', 'дня', 'дней'] as const;

  it('выбирает форму по последней цифре', () => {
    expect([1, 2, 5, 21, 22, 25].map((n) => plural(n, days))).toEqual([
      'день',
      'дня',
      'дней',
      'день',
      'дня',
      'дней',
    ]);
  });

  it('11–14 — всегда «дней»', () => {
    expect([11, 12, 13, 14, 111].map((n) => plural(n, days))).toEqual([
      'дней',
      'дней',
      'дней',
      'дней',
      'дней',
    ]);
  });

  it('ноль — «дней»; склеивает число и слово неразрывным пробелом', () => {
    expect(plural(0, days)).toBe('дней');
    expect(countWord(3, ['объект', 'объекта', 'объектов'])).toBe(`3${NBSP}объекта`);
  });
});

describe('даты', () => {
  it('короткая дата: «5 окт.», год — только если он не текущий', () => {
    expect(asText(formatShortDate('2026-10-05'))).toBe('5 окт.');
    expect(asText(formatShortDate('2026-11-14', '2026-10-22'))).toBe('14 нояб.');
    expect(asText(formatShortDate('2027-01-14', '2026-10-22'))).toBe('14 янв. 2027');
  });

  it('длинная дата и день недели', () => {
    expect(asText(formatLongDate('2026-10-22'))).toBe('22 октября');
    expect(weekdayName('2026-10-22')).toBe('Четверг');
    expect(weekdayName('2026-10-05')).toBe('Понедельник');
  });

  it('разница и сдвиг учитывают границы месяцев и года', () => {
    expect(daysBetween('2026-10-22', '2026-11-14')).toBe(23);
    expect(daysBetween('2026-10-22', '2026-09-30')).toBe(-22);
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('относительные сроки по-русски', () => {
    expect(formatRelativeDays(0)).toBe('сегодня');
    expect(formatRelativeDays(1)).toBe('завтра');
    expect(formatRelativeDays(23)).toBe('через 23 дня');
    expect(formatRelativeDays(-2)).toBe('2 дня назад');
    expect(formatRelativeDays(120)).toBe('через 4 месяца');
  });
});

describe('деньги', () => {
  it('рубли без копеек, если их нет; тысячи — неразрывным пробелом', () => {
    expect(asText(formatRub(350_000))).toBe('3 500 ₽');
    expect(asText(formatRub(1_484_000))).toBe('14 840 ₽');
    expect(asText(formatRub(184_050))).toBe('1 840,50 ₽');
    expect(asText(formatRub(5))).toBe('0,05 ₽');
  });

  it('копейки обязаны быть целыми', () => {
    expect(() => formatRub(10.5)).toThrow();
  });
});

describe('числа из полей ввода', () => {
  it('принимают и запятую, и точку', () => {
    expect(parseDecimal('147,512')).toBe(147.512);
    expect(parseDecimal('147.512')).toBe(147.512);
    expect(parseDecimal(' 14 827 ')).toBe(14_827);
  });

  it('отвергают пустое и нечисловое', () => {
    for (const bad of ['', ' ', 'abc', '1,2,3', '-5', '1e3', '12 ,5x']) {
      expect(parseDecimal(bad)).toBeNull();
    }
  });

  it('печатают с десятичной запятой', () => {
    expect(formatDecimal(147.512, 3)).toBe('147,512');
    expect(formatDecimal(3.4, 1)).toBe('3,4');
    expect(asText(formatDecimal(14_827, 0))).toBe('14 827');
    expect(formatDecimal(14_827, 0, false)).toBe('14827');
    expect(asText(formatDecimal(1234.5, 1))).toBe('1 234,5');
  });
});

describe('прочее', () => {
  it('нормализует регистр и «ё»', () => {
    expect(normalizeText('Берёзовка')).toBe('березовка');
  });

  it('ссылка tel: только из цифр и плюса', () => {
    expect(toTelHref('+7 (900) 555-01-23')).toBe('tel:+79005550123');
  });

  it('тип DateOnly принимает строки нужной формы', () => {
    const date: DateOnly = '2026-10-22';
    expect(date).toBe('2026-10-22');
  });
});
