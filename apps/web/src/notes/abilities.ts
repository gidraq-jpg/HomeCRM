import {
  type Audience,
  canChangeAudience,
  canCopyToPersonal,
  canCreate,
  canMove,
  canRestore,
  canTrash,
  canWrite,
  type Placement,
  type RecordFacts,
  type Role,
  type Viewer,
} from '@homecrm/shared';
import { VISIBILITIES, type Visibility } from '../access/visibility.ts';
import type { Me } from '../auth/api.ts';
import type { Placement as NewPlacement } from './api.ts';

// Что можно делать с заметкой. Решения принимает эталонный модуль правил доступа из общего
// пакета (access.ts): интерфейс только спрашивает его и прячет недоступные действия.
// Сервер и база проверяют то же самое сами, поэтому ошибка здесь не откроет лишнего.

export function viewerOf(me: Pick<Me, 'id' | 'roles'>): Viewer {
  return {
    accountId: me.id,
    memberships: new Map<string, Role>(
      me.roles.map(({ householdId, role }) => [householdId, role]),
    ),
  };
}

/** Что нужно правилам доступа от записи: место, автор, ответственный и корзина. */
export interface PlacedRecord {
  spaceId: string;
  spaceKind: 'personal' | 'household';
  audience: Audience | null;
  authorId: string;
  assigneeId: string | null;
  deletedAt: string | null;
}

/** Где лежит запись. Личное видит только владелец, поэтому владелец — тот, кто её открыл. */
export function placementOf(note: PlacedRecord, viewer: Viewer): Placement {
  return note.spaceKind === 'personal'
    ? { kind: 'personal', spaceId: note.spaceId, ownerId: note.assigneeId ?? viewer.accountId }
    : { kind: 'household', spaceId: note.spaceId, audience: note.audience ?? 'household' };
}

export function factsOf(note: PlacedRecord, viewer: Viewer, type = 'note'): RecordFacts {
  return {
    type,
    placement: placementOf(note, viewer),
    authorId: note.authorId,
    assigneeId: note.assigneeId,
    trashed: note.deletedAt !== null,
  };
}

/** Значок и подпись «Кто видит»: «Только я», «Взрослые» или «Вся семья». */
export function visibilityOf(note: Pick<PlacedRecord, 'spaceKind' | 'audience'>): Visibility {
  return note.spaceKind === 'personal' ? 'personal' : (note.audience ?? 'household');
}

/** Заметка, которую читатель видит в общем пространстве. */
export function isShared(note: Pick<PlacedRecord, 'spaceKind'>): boolean {
  return note.spaceKind === 'household';
}

export interface NoteAbilities {
  /** Править текст, чек-лист и закрепление. */
  edit: boolean;
  trash: boolean;
  /** Из корзины можно только вернуть; это право отдельное от «править». */
  restore: boolean;
  /** «Поделиться…»: владелец личной заметки. Перенос в личное не требует подтверждения. */
  share: boolean;
  /** «Кто видит…»: взрослый, заметка в общем пространстве. */
  audience: boolean;
  /**
   * «Сделать личной…»: автор общей заметки. Есть ли в ней чужой вклад, интерфейс не знает:
   * это решает сервер (`access-preview` отвечает отказом), см. `useMakePersonalProbe`.
   */
  makePersonal: boolean;
  /** «Скопировать в личное»: любой читатель общей заметки. */
  copy: boolean;
}

const personalPlace = (viewer: Viewer): Placement => ({
  kind: 'personal',
  // Для правила переноса важен только владелец: личное пространство у заметки одно.
  spaceId: viewer.accountId,
  ownerId: viewer.accountId,
});

/** Права на запись; `type` — вид записи для правил ребёнка (`note`, `object`). */
export function noteAbilities(
  viewer: Viewer,
  note: PlacedRecord,
  householdId: string | null,
  type = 'note',
): NoteAbilities {
  const facts = factsOf(note, viewer, type);
  const shared = isShared(note);
  const target: Placement | null =
    householdId === null
      ? null
      : { kind: 'household', spaceId: householdId, audience: 'household' };
  return {
    edit: canWrite(viewer, facts),
    trash: canTrash(viewer, facts),
    restore: canRestore(viewer, facts),
    share: !shared && target !== null && canMove(viewer, facts, target, false),
    audience:
      shared &&
      canChangeAudience(viewer, facts, {
        kind: 'household',
        spaceId: note.spaceId,
        audience: 'household',
      }),
    makePersonal: shared && canMove(viewer, facts, personalPlace(viewer), false),
    copy: shared && canCopyToPersonal(viewer, facts),
  };
}

/**
 * Значения «Кто видит» для новой заметки: те, что разрешает `canCreate`. Ребёнок создаёт общие
 * записи только покупок и дел (PRD 6.2), поэтому для него остаётся «Только я».
 */
export function creatableVisibilities(
  viewer: Viewer,
  householdId: string | null,
  type = 'note',
): Visibility[] {
  return VISIBILITIES.filter((visibility) => {
    if (visibility === 'personal') return true;
    if (householdId === null) return false;
    return canCreate(viewer, {
      type,
      authorId: viewer.accountId,
      placement: { kind: 'household', spaceId: householdId, audience: visibility },
    });
  });
}

/** Аргумент `placement` для создания; у личной заметки его нет — сервер берёт личное пространство. */
export function newPlacement(
  visibility: Visibility,
  householdId: string | null,
): NewPlacement | undefined {
  if (visibility === 'personal' || householdId === null) return undefined;
  const audience: Audience = visibility;
  return { spaceId: householdId, audience };
}
