import { and, eq, isNull, spaceMembers, type Transaction } from '@homecrm/db';
import {
  canBeAssignee,
  canChangeAudience,
  canMove,
  type Placement,
  type TaskFields,
} from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { columnsOf, deny, Failure, factsOf } from '../objects/support.ts';
import type { Task } from './routes.ts';
export function repeatTemplate(data: TaskFields, assigneeId?: string) {
  return {
    planOn: data.planOn,
    overduePolicy: data.overduePolicy,
    assigneeId,
    title: data.title,
    description: data.description,
    checklist: data.checklist,
    planTime: data.planTime,
    dueTime: data.dueTime,
    dueOffset:
      data.planOn && data.dueOn
        ? (Date.parse(data.dueOn) - Date.parse(data.planOn)) / 86400000
        : null,
  };
}
export async function assignmentPlacement(
  tx: Transaction,
  account: Account,
  place: Placement,
  id: string,
  confirmed = false,
  householdId?: string,
  old?: Task,
): Promise<Placement> {
  const memberships = await tx
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.accountId, id), isNull(spaceMembers.leftAt)));
  const viewer = {
    accountId: id,
    memberships: new Map(memberships.map((m) => [m.spaceId, m.role])),
  };
  if (canBeAssignee(viewer, place)) return place;
  const house =
    place.kind === 'household'
      ? place.spaceId
      : (householdId ??
        memberships.find((m) => account.viewer.memberships.has(m.spaceId))?.spaceId);
  const member = memberships.find((m) => m.spaceId === house);
  const proposed: Placement | null =
    house && member && account.viewer.memberships.has(house)
      ? {
          kind: 'household',
          spaceId: house,
          audience:
            member.role === 'child'
              ? 'household'
              : place.kind === 'household'
                ? place.audience
                : 'adults',
        }
      : null;
  if (!confirmed || !proposed) {
    const failure = new Failure(409, 'ASSIGNEE_NOT_VISIBLE');
    failure.details = {
      requiresAudienceExpansion: true,
      suggestedPlacement: proposed
        ? {
            spaceId: proposed.spaceId,
            audience: proposed.kind === 'household' ? proposed.audience : undefined,
          }
        : null,
    };
    throw failure;
  }
  if (
    old &&
    !(old.spaceId === proposed.spaceId
      ? canChangeAudience(account.viewer, factsOf(old, 'task'), proposed)
      : canMove(account.viewer, factsOf(old, 'task'), proposed, old.hasOtherContributions))
  )
    deny();
  return proposed;
}
export { columnsOf };
