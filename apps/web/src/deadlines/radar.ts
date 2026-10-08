import type { DeadlineRule, RADAR_GROUPS } from '@homecrm/shared';
import { PROPERTY_STATUSES } from '@homecrm/shared';
import { matchesScope, type Scope } from '../access/scope.ts';
import type { Visibility } from '../access/visibility.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { todayIn } from '../objects/dates.ts';
import type { PropertyStatus } from '../property/property.ts';
import type { DateOnly } from '../ui/format.ts';
import type { PrimaryAction, RadarItem, SourceKind, UtilitySourceKind } from './api.ts';
import { describeRule, KIND_LABELS, occurrenceRelative, occurrenceWhen } from './labels.ts';

// Радар (DEAD-3): пункты из наступлений срока, названия записей и подписи правил.
// Всё, что решает, кто что видит, делает сервер; здесь только подписи и фильтры показа.

export type RadarGroup = (typeof RADAR_GROUPS)[number];

/** Группы радара по порядку: сначала самое срочное. */
export const GROUP_ORDER: readonly RadarGroup[] = ['overdue', 'now', '7days', '30days', '90days'];

export const GROUP_LABELS: Readonly<Record<RadarGroup, string>> = {
  overdue: 'Просрочено',
  now: 'Сейчас',
  '7days': '7 дней',
  '30days': '30 дней',
  '90days': '90 дней',
};

/** Пояснение к группе: что в неё попадает. */
export const GROUP_HINTS: Readonly<Record<RadarGroup, string>> = {
  overdue: 'Срок прошёл, а пункт не закрыт.',
  now: 'Открытые окна и сроки на сегодня.',
  '7days': 'Ближайшая неделя.',
  '30days': 'До месяца.',
  '90days': 'До трёх месяцев.',
};

export type RadarView = 'mine' | 'house';

export const VIEW_LABELS: Readonly<Record<RadarView, string>> = {
  mine: 'Моё',
  house: 'Весь дом',
};

/** Где найти срок: запись-источник и его правило. */
export interface LocatedDeadline {
  kind: SourceKind;
  sourceId: string;
  rule: DeadlineRule;
}

/** Подписи видов коммунальных сроков (UTIL-13). */
export const UTILITY_WHAT: Readonly<Record<UtilitySourceKind, string>> = {
  readings: 'Окно показаний',
  payment: 'Оплата',
  verification: 'Поверка счётчика',
};

/** Что известно о коммунальном сроке: объект первым, затем счёт или счётчик и основное действие. */
export interface UtilityRow {
  kind: UtilitySourceKind;
  occurrenceId: string;
  objectId: string;
  /** Статус недвижимости: «живём», «сдаётся»; рядом с названием, чтобы не перепутать квартиры. */
  status: PropertyStatus | null;
  /** Лицевой счёт с номером или счётчик. */
  source: string;
  accountId: string | null;
  /** Начисление срока оплаты: по нему оплата отмечается и отменяется как денежная запись. */
  chargeId: string | null;
  meterId: string | null;
  action: PrimaryAction | null;
  /** Окно без активных счётчиков: вместо показаний — подсказка и «Передано». */
  needsMeters: boolean;
  startDate: DateOnly;
  endDate: DateOnly;
  /** Управляемый срок не правится в радаре: вместо этого ссылка на счёт или счётчик. */
  openLabel: 'Открыть счёт' | 'Открыть счётчик';
  openTo: string;
}

export function propertyStatusOf(value: string | null | undefined): PropertyStatus | null {
  return PROPERTY_STATUSES.find((status) => status === value) ?? null;
}

export interface RadarRow {
  id: string;
  group: RadarGroup;
  /** Название записи; пусто, если запись не удалось сопоставить. */
  title: string | null;
  /** Что за срок: «Повтор» и правило словами. */
  what: string;
  when: string;
  relative: string;
  visibility: Visibility;
  assigneeId: string;
  startsAt: number;
  /** Переход в карточку записи; без источника перехода нет. */
  to: string | null;
  /** Коммунальный срок: объект, счёт или счётчик, основное действие; у прежних сроков пусто. */
  utility: UtilityRow | null;
}

export interface RowContext {
  timeZone: string;
  now: Date;
  /** Название записи по виду и идентификатору. */
  titleOf: (kind: SourceKind, id: string) => string | undefined;
  locate: (deadlineId: string) => LocatedDeadline | undefined;
  today: DateOnly;
}

export function cardPath(kind: SourceKind, id: string): string {
  return kind === 'notes' ? `/more/notes/${id}` : `/home/${id}`;
}

/** Коммунальный срок из пункта радара; прежние сроки и пункты без объекта дают `null`. */
export function utilityOf(item: RadarItem, endsAt: Date): UtilityRow | null {
  if (item.sourceKind === 'record' || !item.object) return null;
  const objectId = item.object.id;
  const account = item.utilityAccount ?? null;
  const meter = item.meter ?? null;
  const isMeterSource = item.sourceKind === 'verification' && meter !== null;
  const number = account?.number ? ` · № ${account.number}` : '';
  return {
    kind: item.sourceKind,
    occurrenceId: item.id,
    objectId,
    status: propertyStatusOf(item.object.status),
    source: isMeterSource ? meter.title : account ? `${account.title}${number}` : 'Лицевой счёт',
    accountId: account?.id ?? null,
    chargeId: item.chargeId ?? null,
    meterId: meter?.id ?? null,
    action: item.primaryAction ?? null,
    needsMeters: item.needsMeters,
    startDate: item.date as DateOnly,
    endDate: todayIn(item.timeZone, endsAt),
    openLabel: isMeterSource ? 'Открыть счётчик' : 'Открыть счёт',
    openTo:
      item.sourceKind === 'payment' && item.chargeId && account
        ? `/home/${objectId}/accounts/${account.id}/charges`
        : `/home/${objectId}/${isMeterSource ? 'meters' : 'accounts'}`,
  };
}

export function buildRows(items: readonly RadarItem[], context: RowContext): RadarRow[] {
  return items.map((item) => {
    const timing = {
      date: item.date,
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
    };
    const utility = utilityOf(item, timing.endsAt);
    if (utility !== null) {
      return {
        id: item.id,
        group: item.group,
        title: item.object?.title ?? null,
        what: UTILITY_WHAT[utility.kind],
        when: occurrenceWhen(timing, item.timeZone, context.now),
        relative: occurrenceRelative(timing, item.timeZone, context.now),
        visibility: visibilityOf({ spaceKind: item.spaceKind, audience: item.audience }),
        assigneeId: item.assigneeId,
        startsAt: timing.startsAt.getTime(),
        to: utility.openTo,
        utility,
      };
    }
    const located = item.rule
      ? {
          rule: item.rule,
          kind: item.noteId ? ('notes' as const) : ('objects' as const),
          sourceId: item.noteId ?? item.objectId ?? '',
        }
      : context.locate(item.deadlineId);
    // Если сервер сам назвал источник, берём его; иначе — найденный по карточкам записей.
    const direct: SourceKind | null = item.noteId ? 'notes' : item.objectId ? 'objects' : null;
    const kind = located?.kind ?? direct;
    const sourceId = located?.sourceId ?? item.noteId ?? item.objectId ?? null;
    return {
      id: item.id,
      group: item.group,
      title: item.title ?? (kind && sourceId ? (context.titleOf(kind, sourceId) ?? null) : null),
      what: located
        ? located.rule.kind === 'date' || located.rule.kind === 'window'
          ? KIND_LABELS[located.rule.kind]
          : `${KIND_LABELS[located.rule.kind]}: ${describeRule(located.rule, context.today)}`
        : 'Срок',
      when: occurrenceWhen(timing, item.timeZone, context.now),
      relative: occurrenceRelative(timing, item.timeZone, context.now),
      visibility: visibilityOf({ spaceKind: item.spaceKind, audience: item.audience }),
      assigneeId: item.assigneeId,
      startsAt: timing.startsAt.getTime(),
      to: kind && sourceId ? cardPath(kind, sourceId) : null,
      utility: null,
    };
  });
}

/** «Моё» — пункты, за которые отвечает сам участник; «Весь дом» — всё, что он видит. */
export function filterRows(
  rows: readonly RadarRow[],
  options: { view: RadarView; scope: Scope; meId: string },
): RadarRow[] {
  return rows.filter(
    (row) =>
      matchesScope(row.visibility, options.scope) &&
      (options.view === 'house' || row.assigneeId === options.meId),
  );
}

export function groupRows(rows: readonly RadarRow[]): Record<RadarGroup, RadarRow[]> {
  const groups: Record<RadarGroup, RadarRow[]> = {
    overdue: [],
    now: [],
    '7days': [],
    '30days': [],
    '90days': [],
  };
  for (const row of [...rows].sort((a, b) => a.startsAt - b.startsAt)) groups[row.group].push(row);
  return groups;
}
