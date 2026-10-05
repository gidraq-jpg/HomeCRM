import { formatDecimal, parseDecimal } from '../ui/format.ts';
import type { Meter } from './model.ts';

// Проверка показания при вводе — PRD, UTIL-5 и правила продукта 5–6:
// значение меньше прошлого не сохраняется; аномальный расход — предупреждение, а не запрет.

/** Расход на 40% и больше выше обычного — повод предупредить (UTIL-5). */
export const ANOMALY_RATIO = 1.4;

export type ReadingCheck =
  | { status: 'empty' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; value: number; consumption: number; warning?: string };

export function checkReading(meter: Meter, input: string): ReadingCheck {
  if (input.trim() === '') return { status: 'empty' };
  const value = parseDecimal(input);
  if (value === null) {
    return { status: 'invalid', message: 'Введите число: цифры, запятая или точка.' };
  }
  if (value < meter.previous) {
    return {
      status: 'invalid',
      message: `Меньше прошлого значения (${formatDecimal(meter.previous, meter.digits)}). Проверьте цифры.`,
    };
  }
  // Сравниваем с учётом точности счётчика, чтобы не ловить хвосты вычислений с плавающей точкой.
  const consumption = Number((value - meter.previous).toFixed(meter.digits));
  if (consumption + 1e-9 >= meter.typical * ANOMALY_RATIO) {
    return {
      status: 'ok',
      value,
      consumption,
      warning: 'Расход выше обычного. Проверьте, нет ли утечки или ошибки.',
    };
  }
  return { status: 'ok', value, consumption };
}

export function formatReading(meter: Meter, value: number): string {
  return `${formatDecimal(value, meter.digits)} ${meter.unit}`;
}

/** Текст для копирования: значения, собранные по лицевым счетам (UTIL-8). */
export function buildTransferText(
  meters: readonly Meter[],
  accountTitles: Readonly<Record<string, { title: string; number: string }>>,
  values: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [];
  const accountIds = [...new Set(meters.map((meter) => meter.accountId))];
  for (const accountId of accountIds) {
    const account = accountTitles[accountId];
    const filled = meters.flatMap((meter) => {
      if (meter.accountId !== accountId) return [];
      const check = checkReading(meter, values[meter.id] ?? '');
      return check.status === 'ok'
        ? [
            `${meter.resource}, ${meter.place.toLowerCase()}: ${formatDecimal(check.value, meter.digits)}`,
          ]
        : [];
    });
    if (filled.length === 0 || account === undefined) continue;
    lines.push(`${account.title}, лицевой счёт ${account.number}`, ...filled, '');
  }
  return lines.join('\n').trim();
}
