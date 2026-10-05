import { canView, type Placement, type Role, type Viewer } from '@homecrm/shared';
import type { Visibility } from './visibility.ts';

// Кто увидит запись при данном значении «Кто видит». Ответ даёт эталонный модуль правил
// доступа из общего пакета, интерфейс сам ничего не решает (AGENTS.md, «Личное остаётся личным»).

export interface HouseMember {
  id: string;
  name: string;
  role: Role;
}

const HOUSE_SPACE = 'house';

function placementOf(visibility: Visibility, ownerId: string): Placement {
  if (visibility === 'personal') {
    return { kind: 'personal', spaceId: `personal:${ownerId}`, ownerId };
  }
  return { kind: 'household', spaceId: HOUSE_SPACE, audience: visibility };
}

function viewerOf(member: HouseMember): Viewer {
  return { accountId: member.id, memberships: new Map([[HOUSE_SPACE, member.role]]) };
}

/** Участники дома, которые увидят запись автора `ownerId` с таким значением. */
export function whoSees(
  visibility: Visibility,
  ownerId: string,
  members: readonly HouseMember[],
): HouseMember[] {
  const placement = placementOf(visibility, ownerId);
  return members.filter((member) => canView(viewerOf(member), placement));
}

/** Кто потеряет доступ, если сменить значение: приложение показывает это перед сужением. */
export function whoLosesAccess(
  from: Visibility,
  to: Visibility,
  ownerId: string,
  members: readonly HouseMember[],
): HouseMember[] {
  const stays = new Set(whoSees(to, ownerId, members).map((member) => member.id));
  return whoSees(from, ownerId, members).filter((member) => !stays.has(member.id));
}
