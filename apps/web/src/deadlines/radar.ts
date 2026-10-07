import type { DeadlineRule, RADAR_GROUPS } from '@homecrm/shared';
import { matchesScope, type Scope } from '../access/scope.ts';
import type { Visibility } from '../access/visibility.ts';
import { visibilityOf } from '../notes/abilities.ts';
import type { DateOnly } from '../ui/format.ts';
import type { RadarItem, SourceKind } from './api.ts';
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

export function buildRows(items: readonly RadarItem[], context: RowContext): RadarRow[] {
  return items.map((item) => {
    const timing = {
      date: item.date,
      startsAt: new Date(item.startsAt),
      endsAt: new Date(item.endsAt),
    };
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
