import { TaskFields } from '@homecrm/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { defaultVisibility } from '../access/visibility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { newPlacement } from '../notes/abilities.ts';
import { Page } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { type TaskDraft, TaskForm } from './TaskForm.tsx';
export function createBody(
  draft: TaskDraft,
  personalSpaceId: string | null,
): Record<string, unknown> {
  return {
    ...TaskFields.strip().parse(draft),
    assigneeId: draft.assigneeId,
    ...(draft.householdId ? { householdId: draft.householdId } : {}),
    ...(draft.objectId ? { objectId: draft.objectId } : {}),
    placement:
      draft.visibility === 'personal'
        ? { spaceId: personalSpaceId }
        : newPlacement(draft.visibility, draft.householdId),
  };
}
export function NewTaskScreen() {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const operation = useTaskOperation((card) => {
    toast.show({ message: 'Дело сохранено' });
    navigate(`/today/tasks/${card.id}`, { replace: true });
  });
  const initial: TaskDraft = {
    ...TaskFields.parse({ title: 'Новое дело' }),
    title: '',
    assigneeId: me.id,
    householdId: me.roles.some((role) => role.householdId === params.get('householdId'))
      ? (params.get('householdId') ?? '')
      : (householdId ?? ''),
    objectId: params.get('objectId') ?? '',
    visibility: defaultVisibility('task', scope),
    repeatScope: 'this',
  };
  return (
    <Page title="Новое дело" back={{ to: '/today', label: 'Сегодня' }}>
      <OperationNotice operation={operation} />
      <TaskForm
        initial={initial}
        pending={operation.pending}
        onSubmit={(draft) =>
          void operation.run({
            path: 'tasks',
            body: createBody(draft, me.personalSpaceId),
            keyed: true,
          })
        }
        onCancel={() => navigate('/today')}
      />
    </Page>
  );
}
