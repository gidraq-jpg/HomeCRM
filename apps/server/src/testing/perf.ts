/** Перцентиль p (0…1) по методу ближайшего ранга; для пустого списка — Infinity, чтобы проверка не прошла. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? Number.POSITIVE_INFINITY;
}
