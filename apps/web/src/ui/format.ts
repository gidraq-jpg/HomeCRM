// Форматирование для интерфейса — PRD, раздел 13: русские формы множественного числа,
// даты вида «5 окт.», суммы в рублях, в числах принимаются и запятая, и точка.

/** Дата без времени и часового пояса: `2026-10-22`. */
export type DateOnly = `${number}-${number}-${number}`;

const NBSP = String.fromCodePoint(0xa0);
const MINUS = String.fromCodePoint(0x2212);

const MONTHS_SHORT = [
  'янв.',
  'февр.',
  'мар.',
  'апр.',
  'мая',
  'июн.',
  'июл.',
  'авг.',
  'сент.',
  'окт.',
  'нояб.',
  'дек.',
] as const;

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const WEEKDAYS = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
] as const;

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;

/** Три формы слова: «1 день», «2 дня», «5 дней». */
export type PluralForms = readonly [one: string, few: string, many: string];

export function plural(count: number, forms: PluralForms): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

/** Число вместе со словом в нужной форме: `3 объекта`. */
export function countWord(count: number, forms: PluralForms): string {
  return `${count}${NBSP}${plural(count, forms)}`;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseDateOnly(date: DateOnly): DateParts {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Некорректная дата: ${date}`);
  }
  return { year, month, day };
}

export function toDateOnly(year: number, month: number, day: number): DateOnly {
  const pad = (value: number, length: number) => String(value).padStart(length, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` as DateOnly;
}

function toUtcDays(date: DateOnly): number {
  const { year, month, day } = parseDateOnly(date);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Сколько дней от `from` до `to`: положительное, если `to` позже. */
export function daysBetween(from: DateOnly, to: DateOnly): number {
  return toUtcDays(to) - toUtcDays(from);
}

export function addDays(date: DateOnly, days: number): DateOnly {
  const moment = new Date((toUtcDays(date) + days) * 86_400_000);
  return toDateOnly(moment.getUTCFullYear(), moment.getUTCMonth() + 1, moment.getUTCDate());
}

/** Название дня недели: «Четверг». */
export function weekdayName(date: DateOnly): string {
  const index = new Date(toUtcDays(date) * 86_400_000).getUTCDay();
  return WEEKDAYS[index] ?? '';
}

export function weekdayShort(date: DateOnly): string {
  const index = new Date(toUtcDays(date) * 86_400_000).getUTCDay();
  return WEEKDAYS_SHORT[index] ?? '';
}

/** «5 окт.»; если год не совпадает с годом `today`, он дописывается: «14 янв. 2027». */
export function formatShortDate(date: DateOnly, today?: DateOnly): string {
  const { year, month, day } = parseDateOnly(date);
  const base = `${day}${NBSP}${MONTHS_SHORT[month - 1] ?? ''}`;
  if (today === undefined || parseDateOnly(today).year === year) return base;
  return `${base}${NBSP}${year}`;
}

/** «14 мар. 1990»: год всегда, например для даты рождения. */
export function formatFullDate(date: DateOnly): string {
  return `${formatShortDate(date)}${NBSP}${parseDateOnly(date).year}`;
}

/** «22 октября». */
export function formatLongDate(date: DateOnly): string {
  const { month, day } = parseDateOnly(date);
  return `${day}${NBSP}${MONTHS_GENITIVE[month - 1] ?? ''}`;
}

const DAYS: PluralForms = ['день', 'дня', 'дней'];
const MONTHS: PluralForms = ['месяц', 'месяца', 'месяцев'];

/** Сколько осталось или прошло: «сегодня», «завтра», «через 23 дня», «2 дня назад». */
export function formatRelativeDays(days: number): string {
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  if (days === -1) return 'вчера';
  if (days > 1) {
    if (days >= 90)
      return `через ${Math.round(days / 30)} ${plural(Math.round(days / 30), MONTHS)}`;
    return `через ${days} ${plural(days, DAYS)}`;
  }
  return `${-days} ${plural(-days, DAYS)} назад`;
}

/** Сумма в копейках → «3 500 ₽» или «1 840,50 ₽». Деньги хранятся только целыми копейками. */
export function formatRub(kopecks: number): string {
  if (!Number.isInteger(kopecks)) throw new Error('Сумма должна быть целым числом копеек');
  const abs = Math.abs(kopecks);
  const rubles = Math.trunc(abs / 100);
  const rest = abs % 100;
  const grouped = String(rubles).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const tail = rest === 0 ? '' : `,${String(rest).padStart(2, '0')}`;
  return `${kopecks < 0 ? MINUS : ''}${grouped}${tail}${NBSP}₽`;
}

/**
 * Число с запятой как десятичным разделителем и, по умолчанию, пробелами между тысячами:
 * `14 827`, `147,512`. Для текста, который копируют в другое приложение, группы отключают.
 */
export function formatDecimal(value: number, fractionDigits: number, group = true): string {
  const [integer = '', fraction] = value.toFixed(fractionDigits).split('.');
  const grouped = group ? integer.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP) : integer;
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/**
 * Разбирает число, введённое с клавиатуры: принимает и запятую, и точку, пробелы внутри
 * игнорирует. Пустая строка и всё, что не похоже на число, — `null`.
 */
export function parseDecimal(input: string): number | null {
  const cleaned = input.replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Для сравнения без учёта регистра и «ё». */
export function normalizeText(text: string): string {
  return text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

/** Номер телефона, пригодный для ссылки `tel:`: только цифры и плюс. */
export function toTelHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
