import { TaskFields } from '@homecrm/shared';
import { useNavigate, useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { defaultVisibility } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { newPlacement, visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { useObjectCard } from '../objects/queries.ts';
import { StudioPage } from '../ui/StudioPage.tsx';
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
    ...(draft.idempotencyKey ? { idempotencyKey: draft.idempotencyKey } : {}),
  };
}
export function NewTaskScreen() {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const objectId = params.get('objectId') || undefined;
  const object = useObjectCard(objectId);
  const operation = useTaskOperation((card) => {
    toast.show({ message: 'Дело сохранено' });
    navigate(`/today/tasks/${card.id}`, { replace: true });
  });
  const initial: TaskDraft = {
    ...TaskFields.parse({ title: 'Новое дело' }),
    title: '',
    assigneeId: me.id,
    householdId:
      object.data?.spaceKind === 'household'
        ? object.data.spaceId
        : me.roles.some((role) => role.householdId === params.get('householdId'))
          ? (params.get('householdId') ?? '')
          : (householdId ?? ''),
    objectId: params.get('objectId') ?? '',
    visibility: defaultVisibility(
      'task',
      scope,
      object.data ? { parent: visibilityOf(object.data) } : {},
    ),
    repeatScope: 'this',
  };
  if (objectId && !object.data)
    return (
      <StudioPage form title="Новое дело" back={{ to: '/today', label: 'Сегодня' }}>
        {object.error ? (
          <>
            <ObjectError error={object.error} action="load" />
            <button type="button" className="text-button" onClick={() => void object.refetch()}>
              Повторить загрузку объекта
            </button>
          </>
        ) : (
          <Notice>Загружаем объект…</Notice>
        )}
      </StudioPage>
    );
  return (
    <StudioPage form title="Новое дело" back={{ to: '/today', label: 'Сегодня' }}>
      <OperationNotice operation={operation} />
      <TaskForm
        initial={initial}
        pending={operation.pending}
        onSubmit={(draft) =>
          void operation.run({
            path: 'tasks',
            body: createBody(draft, me.personalSpaceId),
            keyed: true,
            draft,
          })
        }
        onCancel={() => navigate('/today')}
      />
    </StudioPage>
  );
}
