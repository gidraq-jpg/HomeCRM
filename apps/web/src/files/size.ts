import { formatDecimal } from '../ui/format.ts';

const NBSP = String.fromCodePoint(0xa0);

/** Размер для людей: «512 Б», «340 КБ», «2,4 МБ». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}${NBSP}Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}${NBSP}КБ`;
  return `${formatDecimal(bytes / (1024 * 1024), 1)}${NBSP}МБ`;
}
