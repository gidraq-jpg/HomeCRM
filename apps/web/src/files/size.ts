import { formatDecimal } from '../ui/format.ts';

const NBSP = String.fromCodePoint(0xa0);
const MEGABYTE = 1024 * 1024;

/** Размер для людей: «512 Б», «340 КБ», «1 МБ», «2,4 МБ». Целые мегабайты — без «,0». */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}${NBSP}Б`;
  const kilobytes = Math.round(bytes / 1024);
  // Четырёхзначных килобайт не бывает: 1 048 000 Б — это «1 МБ», а не «1023 КБ» и не «1024 КБ».
  if (kilobytes < 1000) return `${kilobytes}${NBSP}КБ`;
  const megabytes = Math.round((bytes / MEGABYTE) * 10) / 10;
  return `${formatDecimal(megabytes, Number.isInteger(megabytes) ? 0 : 1)}${NBSP}МБ`;
}
