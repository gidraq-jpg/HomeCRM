// Даты для людей (PRD, раздел 13): часовой пояс дома, вид «5 окт., 08:52», год — только если он не текущий.

function parts(value: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const result: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    hourCycle: 'h23',
    ...options,
  }).formatToParts(value))
    result[part.type] = part.value;
  return result;
}

/** «5 окт.» или «5 окт. 2025», если год не текущий в часовом поясе дома. */
export function formatDay(value: string | Date, timeZone: string, now: Date = new Date()): string {
  const moment = new Date(value);
  const day = parts(moment, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
  const current = parts(now, timeZone, { year: 'numeric' });
  const text = `${day.day} ${day.month}`;
  return day.year === current.year ? text : `${text} ${day.year}`;
}

/** «5 окт., 08:52» или «5 окт. 2025, 08:52». */
export function formatMoment(
  value: string | Date,
  timeZone: string,
  now: Date = new Date(),
): string {
  const time = parts(new Date(value), timeZone, { hour: '2-digit', minute: '2-digit' });
  return `${formatDay(value, timeZone, now)}, ${time.hour}:${time.minute}`;
}
