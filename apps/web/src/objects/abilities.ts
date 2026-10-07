import { canBeAssignee, canRestore, canTrash, type Role, type Viewer } from '@homecrm/shared';
import type { Member } from '../household/api.ts';
import {
  creatableVisibilities,
  factsOf,
  type NoteAbilities,
  noteAbilities,
  type PlacedRecord,
  placementOf,
} from '../notes/abilities.ts';
import type { ManualEvent } from './api.ts';

// Что можно делать с объектом и его событиями. Решения принимает эталонный модуль правил доступа
// (access.ts): интерфейс только спрашивает его и прячет недоступные действия. Ребёнок в общем
// пространстве объекты не меняет — это решает `canWrite` по виду записи `object`.

export type ObjectAbilities = NoteAbilities;

export const OBJECT_TYPE = 'object';
export const EVENT_TYPE = 'object_event';

export function objectAbilities(
  viewer: Viewer,
  card: PlacedRecord,
  householdId: string | null,
): ObjectAbilities {
  return noteAbilities(viewer, card, householdId, OBJECT_TYPE);
}

/** Значения «Кто видит» для нового объекта: те, что разрешает `canCreate`. */
export function creatableObjectVisibilities(viewer: Viewer, householdId: string | null) {
  return creatableVisibilities(viewer, householdId, OBJECT_TYPE);
}

export interface EventAbilities {
  /** Править своё событие, если объект можно менять. */
  edit: boolean;
  trash: boolean;
  /** Вернуть удалённое событие: нужно для отмены в течение 7 секунд. */
  restore: boolean;
}

/** Событие живёт в месте объекта; менять и убирать в корзину можно только своё (OBJ-3). */
export function eventAbilities(
  viewer: Viewer,
  card: PlacedRecord,
  event: Pick<ManualEvent, 'authorId' | 'deletedAt'>,
  objectEdit: boolean,
): EventAbilities {
  const facts = { ...factsOf(card, viewer, EVENT_TYPE), authorId: event.authorId };
  const own = event.authorId === viewer.accountId && event.deletedAt === null;
  return {
    edit: objectEdit && own,
    trash: objectEdit && own && canTrash(viewer, facts),
    restore: canRestore(viewer, facts),
  };
}
export interface AssigneeChoice {
  id: string;
  name: string;
}

/**
 * Кого можно назначить ответственным: действующие участники дома, которые увидят объект
 * (PRD 7.3.4, 7.3.9). У личного объекта ответственный всегда владелец, выбора нет.
 */
export function assigneeChoices(
  viewer: Viewer,
  card: PlacedRecord,
  members: readonly Member[],
): AssigneeChoice[] {
  if (card.spaceKind === 'personal') return [];
  const place = placementOf(card, viewer);
  return members
    .filter((member) => !member.formerMember)
    .filter((member) =>
      canBeAssignee(
        {
          accountId: member.accountId,
          memberships: new Map<string, Role>([[card.spaceId, member.role]]),
        },
        place,
      ),
    )
    .map((member) => ({ id: member.accountId, name: member.displayName }));
}
