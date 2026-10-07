// Сумма события — рубли в поле ввода, целые копейки в API и базе (PRD, раздел 13).

const MINUS = String.fromCodePoint(0x2212);

export type RublesInput = { ok: true; kopecks: number | null } | { ok: false };

/**
 * Разбирает рубли из поля ввода: принимает запятую и точку, пробелы между тысячами, до двух
 * знаков после запятой и знак «минус». Пустая строка — суммы нет. Дробей с плавающей точкой
 * нет: рубли и копейки считаются целыми.
 */
export function parseRubles(input: string): RublesInput {
  const cleaned = input.replace(/\s+/g, '').replace(',', '.').replace(MINUS, '-');
  if (cleaned === '') return { ok: true, kopecks: null };
  const match = /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false };
  const [, sign = '', rubles = '0', rest = ''] = match;
  const total = Number(rubles) * 100 + Number(rest.padEnd(2, '0'));
  if (!Number.isSafeInteger(total)) return { ok: false };
  return { ok: true, kopecks: sign === '-' ? -total : total };
}

/** Копейки → строка для поля ввода: `3500` или `1840,50`. */
export function kopecksToInput(kopecks: number): string {
  const abs = Math.abs(kopecks);
  const rest = abs % 100;
  const base = String(Math.trunc(abs / 100));
  const text = rest === 0 ? base : `${base},${String(rest).padStart(2, '0')}`;
  return kopecks < 0 ? `-${text}` : text;
}
