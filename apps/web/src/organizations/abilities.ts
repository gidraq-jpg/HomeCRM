import type { Viewer } from '@homecrm/shared';
import type { Visibility } from '../access/visibility.ts';
import {
  creatableVisibilities,
  type NoteAbilities,
  noteAbilities,
  type PlacedRecord,
} from '../notes/abilities.ts';
import type { Placement } from '../notes/api.ts';

// Что можно делать с организацией. Решения принимает эталонный модуль правил доступа (access.ts);
// интерфейс только спрашивает его и прячет недоступные действия. Вид записи — `contact`.

export const CONTACT_TYPE = 'contact';

export type OrganizationAbilities = NoteAbilities;

export function organizationAbilities(
  viewer: Viewer,
  card: PlacedRecord,
  householdId: string | null,
): OrganizationAbilities {
  return noteAbilities(viewer, card, householdId, CONTACT_TYPE);
}

/**
 * Где можно создать организацию: общие места по правилам доступа и «Только я» — через id личного
 * пространства из `/me`. Без дома остаётся личное: сервер сам берёт личное пространство.
 */
export function creatableOrganizationVisibilities(
  viewer: Viewer,
  householdId: string | null,
  personalSpaceId: string | null,
): Visibility[] {
  if (householdId === null) return ['personal'];
  return creatableVisibilities(viewer, householdId, CONTACT_TYPE).filter(
    (visibility) => visibility !== 'personal' || personalSpaceId !== null,
  );
}

/** Аргумент `placement` для создания организации; без дома и личного пространства его нет. */
export function organizationPlacement(
  visibility: Visibility,
  householdId: string | null,
  personalSpaceId: string | null,
): Placement | undefined {
  if (visibility === 'personal') return personalSpaceId ? { spaceId: personalSpaceId } : undefined;
  if (householdId === null) return undefined;
  return { spaceId: householdId, audience: visibility };
}
