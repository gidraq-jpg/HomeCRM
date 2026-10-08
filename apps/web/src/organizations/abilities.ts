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
 * Где можно создать организацию. «Только я» не предлагается: идентификатора личного пространства
 * клиент не знает, а без `placement` сервер создаёт организацию общей. Без дома остаётся личное:
 * тогда сервер сам берёт личное пространство.
 */
export function creatableOrganizationVisibilities(
  viewer: Viewer,
  householdId: string | null,
): Visibility[] {
  if (householdId === null) return ['personal'];
  return creatableVisibilities(viewer, householdId, CONTACT_TYPE).filter(
    (visibility) => visibility !== 'personal',
  );
}

/** Аргумент `placement` для создания организации; без дома его нет. */
export function organizationPlacement(
  visibility: Visibility,
  householdId: string | null,
): Placement | undefined {
  if (visibility === 'personal' || householdId === null) return undefined;
  return { spaceId: householdId, audience: visibility };
}
