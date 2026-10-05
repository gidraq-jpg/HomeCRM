import type { Visibility } from '../access/visibility.ts';
import {
  type DateOnly,
  daysBetween,
  formatRub,
  formatShortDate,
  parseDateOnly,
  toDateOnly,
} from '../ui/format.ts';
import { ACCOUNTS, CHARGES, METERS, PEOPLE } from './data/index.ts';
import type { PropertyStatus, ProtoRecord } from './model.ts';
import type { ReadingsEntry } from './state.ts';

// Радар — всё, что требует внимания, по горизонтам (PRD, DEAD-3). Здесь он считается из
// вымышленных данных и их изменений: так личные и общие пункты попадают в него сами
// и фильтруются тем же переключателем, что и остальные разделы.

export type RadarGroup = 'overdue' | 'now' | 'week' | 'month' | 'quarter';

export const RADAR_GROUPS: readonly { group: RadarGroup; label: string }[] = [
  { group: 'overdue', label: 'Просрочено' },
  { group: 'now', label: 'Сейчас' },
  { group: 'week', label: '7 дней' },
  { group: 'month', label: '30 дней' },
  { group: 'quarter', label: '90 дней' },
];

export type RadarKind = 'window' | 'payment' | 'document' | 'birthday';

export interface RadarItem {
  id: string;
  kind: RadarKind;
  group: RadarGroup;
  title: string;
  /** Где: объект или владелец документа. У дня рождения места нет. */
  place?: string;
  /** Срок и сумма: «до 25 окт.», «1 480 ₽ · срок 20 окт.». */
  detail: string;
  visibility: Visibility;
  /** Куда ведёт пункт. */
  to: string;
  /** Основное действие по типу пункта (DEAD-4). */
  action: string;
  dueDate: DateOnly;
  /** Объект, к которому относится пункт, — для блока «Ближайшее» в его карточке. */
  propertyId?: string;
}

export function groupForDays(days: number): RadarGroup | null {
  if (days < 0) return 'overdue';
  if (days === 0) return 'now';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  if (days <= 90) return 'quarter';
  return null;
}

/** Ближайшая годовщина даты, включая сегодняшний день. */
export function nextOccurrence(date: DateOnly, today: DateOnly): DateOnly {
  const source = parseDateOnly(date);
  const now = parseDateOnly(today);
  const thisYear = toDateOnly(now.year, source.month, source.day);
  return daysBetween(today, thisYear) >= 0
    ? thisYear
    : toDateOnly(now.year + 1, source.month, source.day);
}

export interface OpenWindow {
  propertyId: string;
  propertyTitle: string;
  status: PropertyStatus;
  visibility: Visibility;
  /** Последний день окна. */
  until: DateOnly;
  /** О каких услугах речь: «вода», «электроэнергия». */
  resources: string[];
  meterCount: number;
  transmitted: boolean;
}

/** Окна показаний, открытые сегодня, — по объектам. */
export function openWindows(
  records: readonly ProtoRecord[],
  readings: Readonly<Record<string, ReadingsEntry>>,
  today: DateOnly,
): OpenWindow[] {
  const { year, month, day } = parseDateOnly(today);
  const result: OpenWindow[] = [];
  for (const property of records) {
    if (property.kind !== 'property') continue;
    const open = ACCOUNTS.flatMap((account) =>
      account.propertyId === property.id &&
      account.window !== undefined &&
      account.window.from <= day &&
      day <= account.window.to
        ? [{ account, window: account.window }]
        : [],
    );
    if (open.length === 0) continue;
    const lastDay = Math.max(...open.map((entry) => entry.window.to));
    const accountIds = new Set(open.map((entry) => entry.account.id));
    result.push({
      propertyId: property.id,
      propertyTitle: property.title,
      status: property.status,
      visibility: property.visibility,
      until: toDateOnly(year, month, lastDay),
      resources: [...new Set(open.map((entry) => entry.account.short))],
      meterCount: METERS.filter((meter) => accountIds.has(meter.accountId)).length,
      transmitted: readings[property.id]?.transmitted === true,
    });
  }
  return result;
}

function sentence(parts: readonly string[]): string {
  const text = parts.join(' и ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function buildRadar(
  records: readonly ProtoRecord[],
  readings: Readonly<Record<string, ReadingsEntry>>,
  today: DateOnly,
): RadarItem[] {
  const items: RadarItem[] = [];
  const properties = new Map(
    records.flatMap((record) => (record.kind === 'property' ? [[record.id, record] as const] : [])),
  );

  for (const window of openWindows(records, readings, today)) {
    if (window.transmitted) continue;
    items.push({
      id: `window-${window.propertyId}`,
      kind: 'window',
      group: 'now',
      title: `Окно показаний: ${window.resources.join(' и ')}`,
      place: window.propertyTitle,
      detail: `до ${formatShortDate(window.until)}`,
      visibility: window.visibility,
      to: `/home/${window.propertyId}/readings`,
      action: 'Внести показания',
      dueDate: window.until,
      propertyId: window.propertyId,
    });
  }

  // Окна, которые откроются в ближайшие 7 дней.
  const { year, month, day } = parseDateOnly(today);
  for (const account of ACCOUNTS) {
    const property = properties.get(account.propertyId);
    if (property === undefined || account.window === undefined) continue;
    const ahead = account.window.from - day;
    if (ahead <= 0 || ahead > 7) continue;
    const opens = toDateOnly(year, month, account.window.from);
    items.push({
      id: `window-soon-${account.id}`,
      kind: 'window',
      group: 'week',
      title: `Откроется окно показаний: ${account.short}`,
      place: property.title,
      detail: `с ${formatShortDate(opens)}`,
      visibility: property.visibility,
      to: `/home/${property.id}/meters`,
      action: 'Открыть счётчики',
      dueDate: opens,
      propertyId: property.id,
    });
  }

  for (const charge of CHARGES) {
    const property = properties.get(charge.propertyId);
    const group = groupForDays(daysBetween(today, charge.due));
    if (charge.paid || property === undefined || group === null) continue;
    items.push({
      id: `payment-${charge.id}`,
      kind: 'payment',
      group,
      title: `Оплата: ${charge.title.toLowerCase()}`,
      place: property.title,
      detail: `${formatRub(charge.amount)} · срок ${formatShortDate(charge.due)}`,
      visibility: property.visibility,
      to: `/home/${property.id}/utilities`,
      action: 'Отметить оплату',
      dueDate: charge.due,
      propertyId: property.id,
    });
  }

  for (const record of records) {
    if (record.kind !== 'document' || record.expires === null) continue;
    const days = daysBetween(today, record.expires);
    const group = groupForDays(days);
    if (group === null) continue;
    items.push({
      id: `document-${record.id}`,
      kind: 'document',
      group,
      title: record.title,
      place: record.owner,
      detail: `${days < 0 ? 'действовал до' : 'действует до'} ${formatShortDate(record.expires, today)}`,
      visibility: record.visibility,
      to: `/documents/${record.id}`,
      action: 'Продлить',
      dueDate: record.expires,
      ...(record.propertyId ? { propertyId: record.propertyId } : {}),
    });
  }

  // Дни рождения участников видны всей семье; контактов — по доступу контакта.
  const birthdays: { id: string; name: string; birthday: DateOnly; visibility: Visibility }[] = [
    ...PEOPLE.map((person) => ({
      id: person.id,
      name: person.name,
      birthday: person.birthday,
      visibility: 'household' as const,
    })),
    ...records.flatMap((record) =>
      record.kind === 'contact' && record.birthday !== undefined
        ? [
            {
              id: record.id,
              name: record.name,
              birthday: record.birthday,
              visibility: record.visibility,
            },
          ]
        : [],
    ),
  ];
  for (const person of birthdays) {
    const date = nextOccurrence(person.birthday, today);
    const group = groupForDays(daysBetween(today, date));
    if (group === null) continue;
    const age = parseDateOnly(date).year - parseDateOnly(person.birthday).year;
    items.push({
      id: `birthday-${person.id}`,
      kind: 'birthday',
      group,
      title: `День рождения: ${person.name}`,
      detail: `${formatShortDate(date)} · исполнится ${age}`,
      visibility: person.visibility,
      to: '/people',
      action: 'Открыть',
      dueDate: date,
    });
  }

  const order = new Map(RADAR_GROUPS.map(({ group }, index) => [group, index]));
  return items.sort(
    (a, b) =>
      (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0) ||
      daysBetween(b.dueDate, a.dueDate) ||
      a.id.localeCompare(b.id),
  );
}

/** Заголовок первой фразы окна: «Вода и электроэнергия». */
export function windowTitle(window: OpenWindow): string {
  return sentence(window.resources);
}
