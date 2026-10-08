// Точные десятичные значения счётчиков (ADR-0032): строки и BigInt, без Number. Сервер принимает
// и возвращает значения строками «123.456»; на экране запятая, при вводе принимается и точка.

const NBSP = String.fromCodePoint(0xa0);

/** Разрядность счётчика: цифры до и после запятой. */
export interface Digits {
  integerDigits: number;
  fractionDigits: number;
}

/**
 * Число из поля ввода → строка с точкой: «12,5» → «12.5», «12,» → «12», «,5» → «0.5».
 * Пробелы внутри игнорируются. Пустое и не похожее на число — `null`.
 */
export function normalizeDecimal(input: string): string | null {
  const cleaned = input.replace(/\s+/g, '').replace(',', '.');
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const [whole = '', fraction = ''] = cleaned.split('.');
  const integer = whole.replace(/^0+(?=\d)/, '') || '0';
  return fraction === '' ? integer : `${integer}.${fraction}`;
}

/** Дробных знаков в нормализованной строке. */
export function fractionLength(text: string): number {
  return text.split('.')[1]?.length ?? 0;
}

/** Значение в минимальных долях счётчика; `null`, если дробных знаков больше, чем у счётчика. */
export function toUnits(text: string, fractionDigits: number): bigint | null {
  const [integer = '0', fraction = ''] = text.split('.');
  if (fraction.length > fractionDigits) return null;
  return (
    BigInt(integer) * 10n ** BigInt(fractionDigits) +
    BigInt(fraction.padEnd(fractionDigits, '0') || '0')
  );
}

/** Минимальные доли → строка с точкой и всеми разрядами счётчика: «100.125», «7». */
export function fromUnits(units: bigint, fractionDigits: number): string {
  const raw = units.toString().padStart(fractionDigits + 1, '0');
  return fractionDigits === 0
    ? raw
    : `${raw.slice(0, -fractionDigits)}.${raw.slice(-fractionDigits)}`;
}

/** Для показа и копирования: запятая вместо точки, без группировки тысяч. */
export function showDecimal(text: string): string {
  return text.replace('.', ',');
}

/** Значение с единицей: «123,456 м³». */
export function showWithUnit(text: string, unit: string): string {
  return `${showDecimal(text)}${NBSP}${unit}`;
}

export type ZoneProblem =
  | { kind: 'format' }
  | { kind: 'precision'; fractionDigits: number }
  | { kind: 'range'; integerDigits: number }
  | { kind: 'lower'; previous: string };

export type ZoneResult =
  | { status: 'empty' }
  | { status: 'invalid'; problem: ZoneProblem }
  | {
      status: 'ok';
      /** Значение в том виде, как его вернёт сервер. */
      value: string;
      /** Расход с прошлого показания; `null`, если прошлого нет. */
      consumption: string | null;
    };

/**
 * Проверка одного значения зоны до отправки: формат, точность, предел разрядов и «не меньше
 * прошлого». Переход через ноль считает расход с учётом разрядности (UTIL-5).
 */
export function checkZone(
  digits: Digits,
  input: string,
  previous: string | null,
  rollover: boolean,
): ZoneResult {
  if (input.trim() === '') return { status: 'empty' };
  const text = normalizeDecimal(input);
  if (text === null) return { status: 'invalid', problem: { kind: 'format' } };
  const units = toUnits(text, digits.fractionDigits);
  if (units === null) {
    return {
      status: 'invalid',
      problem: { kind: 'precision', fractionDigits: digits.fractionDigits },
    };
  }
  const scale = 10n ** BigInt(digits.integerDigits + digits.fractionDigits);
  if (units >= scale) {
    return { status: 'invalid', problem: { kind: 'range', integerDigits: digits.integerDigits } };
  }
  const value = fromUnits(units, digits.fractionDigits);
  if (previous === null) return { status: 'ok', value, consumption: null };
  const before = toUnits(previous, digits.fractionDigits) ?? 0n;
  if (units >= before) {
    return { status: 'ok', value, consumption: fromUnits(units - before, digits.fractionDigits) };
  }
  if (!rollover) return { status: 'invalid', problem: { kind: 'lower', previous } };
  return {
    status: 'ok',
    value,
    consumption: fromUnits(scale - before + units, digits.fractionDigits),
  };
}

/** Текст ошибки у поля — по-русски, с подсказкой, что делать. */
export function problemText(problem: ZoneProblem, digits: Digits): string {
  switch (problem.kind) {
    case 'format':
      return 'Введите число: цифры, запятая или точка.';
    case 'precision':
      return digits.fractionDigits === 0
        ? 'У этого счётчика нет цифр после запятой: введите целое число.'
        : `После запятой не больше ${digits.fractionDigits} знаков.`;
    case 'range':
      return `До запятой не больше ${problem.integerDigits} цифр: проверьте, что вы ввели.`;
    case 'lower':
      return `Меньше прошлого: ${showDecimal(problem.previous)}`;
  }
}
