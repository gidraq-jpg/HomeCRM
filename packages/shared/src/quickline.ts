import { CalendarDate, calendarInstant, localDate, shiftLocalDays, TimeZone } from './deadlines.ts';

export interface QuicklineOptions {
  now: Date;
  timeZone: string;
  members: readonly { id: string; name: string }[];
  objects: readonly { id: string; name: string }[];
}
export interface QuicklineFragment {
  kind: 'date' | 'time' | 'assignee' | 'object';
  start: number;
  end: number;
  text: string;
  value: string;
}
const months = [
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
];
const weekdays: Record<string, number> = {
  понедельник: 1,
  пн: 1,
  вторник: 2,
  вт: 2,
  среду: 3,
  среда: 3,
  ср: 3,
  четверг: 4,
  чт: 4,
  пятницу: 5,
  пятница: 5,
  пт: 5,
  субботу: 6,
  суббота: 6,
  сб: 6,
  воскресенье: 0,
  вс: 0,
};
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Чистый разбор: позиции UTF-16 относятся к исходной строке, как в браузере. */
export function parseQuickline(input: string, options: QuicklineOptions) {
  TimeZone.parse(options.timeZone);
  const today = localDate(options.now, options.timeZone);
  const base = calendarInstant(today, options.timeZone);
  const fragments: QuicklineFragment[] = [];
  const claimed = new Set<QuicklineFragment['kind']>();
  function add(kind: QuicklineFragment['kind'], start: number, text: string, value: string) {
    if (claimed.has(kind) || fragments.some((f) => start < f.end && start + text.length > f.start))
      return;
    fragments.push({ kind, start, end: start + text.length, text, value });
    claimed.add(kind);
  }
  // Имена могут содержать пробелы; совпадение нескольких участников остаётся в названии.
  for (const [kind, prefix, entries] of [
    ['assignee', '@', options.members],
    ['object', '#', options.objects],
  ] as const) {
    const groups = new Map<string, (typeof entries)[number][]>();
    for (const entry of entries) {
      const name = normalize(entry.name.trim());
      if (!name) continue;
      groups.set(name, [...(groups.get(name) ?? []), entry]);
    }
    for (const [name, matches] of [...groups].sort((a, b) => b[0].length - a[0].length)) {
      if (matches.length !== 1) continue;
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])${prefix}${name.split(/\s+/).map(escaped).join('\\s+')}(?![\\p{L}\\p{N}_])`,
        'gu',
      );
      for (const match of input.matchAll(new RegExp(pattern.source.replace(/е/g, '[её]'), 'giu'))) {
        add(
          kind,
          match.index,
          input.slice(match.index, match.index + match[0].length),
          matches[0]?.id ?? '',
        );
      }
    }
  }
  const dates =
    /(?<![\p{L}\p{N}])(?:послезавтра|сегодня|завтра|через\s+(?:неделю|\d{1,3}\s+(?:день|дня|дней))|в\s+(?:понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)|\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)(?:\s+\d{4})?|\d{1,2}\.\d{1,2}(?:\.\d{4})?)(?![\p{L}\p{N}.])/giu;
  for (const match of input.matchAll(dates)) {
    const text = normalize(match[0]).replace(/\s+/g, ' ');
    let date: string | undefined;
    let offset: number | undefined;
    if (['сегодня', 'завтра', 'послезавтра'].includes(text))
      offset = ['сегодня', 'завтра', 'послезавтра'].indexOf(text);
    else if (text.startsWith('через '))
      offset = text === 'через неделю' ? 7 : Number(text.match(/\d+/)?.[0]);
    else if (text.startsWith('в ')) {
      const target = weekdays[text.slice(2)];
      const current = new Date(`${today}T00:00:00Z`).getUTCDay();
      if (target !== undefined) offset = (target - current + 7) % 7 || 7;
    } else {
      const parts = text.split(/[. ]/);
      const day = Number(parts[0]);
      const month = text.includes('.') ? Number(parts[1]) : months.indexOf(parts[1] ?? '') + 1;
      const year = parts[2] ? Number(parts[2]) : Number(today.slice(0, 4));
      date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!parts[2] && date < today) date = `${year + 1}${date.slice(4)}`;
    }
    if (offset !== undefined && Number.isFinite(offset))
      date = localDate(shiftLocalDays(base, offset, options.timeZone), options.timeZone);
    const parsed = CalendarDate.safeParse(date);
    if (parsed.success) add('date', match.index, match[0], parsed.data);
  }
  const times = /(?<![\p{L}\p{N}])в\s+(\d{1,2})(?:\s*:\s*(\d{2}))?(?![\p{L}\p{N}:.,])/giu;
  for (const match of input.matchAll(times)) {
    const hour = Number(match[1]),
      minute = Number(match[2] ?? 0);
    if (hour < 24 && minute < 60)
      add(
        'time',
        match.index,
        match[0],
        `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      );
  }
  fragments.sort((a, b) => a.start - b.start);
  let title = '',
    cursor = 0;
  for (const fragment of fragments) {
    title += input.slice(cursor, fragment.start);
    cursor = fragment.end;
  }
  title += input.slice(cursor);
  const value = (kind: QuicklineFragment['kind']) =>
    fragments.find((f) => f.kind === kind)?.value ?? null;
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    planOn: value('date'),
    planTime: value('time'),
    assigneeId: value('assignee'),
    objectId: value('object'),
    fragments,
  };
}
