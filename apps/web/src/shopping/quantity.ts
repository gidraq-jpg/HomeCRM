/** Сохраняем единицу и десятичную дробь; свободный текст количества не меняем. */
export function quantityStep(quantity: string | null, delta: number): string | null {
  if (!quantity) return delta > 0 ? '2' : null;
  const match = /^(\d+(?:[.,]\d+)?)(\s.*)?$/u.exec(quantity);
  if (!match) return null;
  const value = Math.round((Number(match[1]?.replace(',', '.')) + delta) * 1000000) / 1000000;
  return value > 0 ? `${String(value).replace('.', ',')}${match[2] ?? ''}` : null;
}
