import { useRef, useState } from 'react';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { ApiError, type ApiMethod } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { mutateTask, TaskError, type TimedTask } from './api.ts';
import { taskError } from './errors.ts';
import { useTaskMembers } from './options.tsx';
import { useRefreshTasks } from './queries.ts';
export interface TaskOperation {
  path: string;
  method?: ApiMethod;
  body: Record<string, unknown>;
  keyed?: boolean;
}
export function useTaskOperation(onSuccess: (card: TimedTask) => void | Promise<void>) {
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const key = useOperationKey();
  const refresh = useRefreshTasks();
  const [error, setError] = useState<unknown>(null);
  const [confirmation, setConfirmation] = useState<{
    request: TaskOperation;
    place: NonNullable<TaskError['suggestedPlacement']>;
  } | null>(null);
  async function run(request: TaskOperation) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      const body = request.keyed
        ? { ...request.body, idempotencyKey: key({ path: request.path, body: request.body }) }
        : request.body;
      const result = await mutateTask(request.path, body, request.method);
      setConfirmation(null);
      await onSuccess(result);
      await refresh();
    } catch (failure) {
      if (
        failure instanceof TaskError &&
        failure.code === 'ASSIGNEE_NOT_VISIBLE' &&
        failure.suggestedPlacement
      )
        setConfirmation({ request, place: failure.suggestedPlacement });
      else {
        setError(
          request.path.endsWith('/undo') && failure instanceof ApiError && failure.status === 409
            ? new ApiError(409, 'UNDO_CONFLICT')
            : request.method === 'PATCH' &&
                failure instanceof ApiError &&
                failure.code === 'HOUSE_REQUIRED'
              ? new ApiError(400, 'LEGACY_HOUSE_REQUIRED')
              : failure,
        );
        if (failure instanceof ApiError && failure.status === 409) await refresh();
      }
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  return {
    run,
    pending,
    error,
    setError,
    confirmation,
    cancelConfirmation: () => setConfirmation(null),
    confirm: () => {
      if (confirmation)
        void run({
          ...confirmation.request,
          body: { ...confirmation.request.body, expandAudience: true },
        });
    },
  };
}
export function OperationNotice({ operation }: { operation: ReturnType<typeof useTaskOperation> }) {
  const { householdId, me } = useHousehold();
  const members = useTaskMembers(
    operation.confirmation?.place.spaceId ?? householdId,
    !!operation.confirmation,
  );
  const confirmation = operation.confirmation;
  const assignee =
    members.data?.find((person) => person.accountId === confirmation?.request.body.assigneeId)
      ?.displayName ??
    (confirmation?.request.body.assigneeId === me.id ? me.displayName : 'выбранный участник');
  return (
    <>
      {operation.error ? <Notice error>{taskError(operation.error)}</Notice> : null}
      {confirmation ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open && !operation.pending) operation.cancelConfirmation();
          }}
          title="Подтвердите доступ"
          description={`Передаём дело: ${assignee}. Запись увидят: ${VISIBILITY_LABELS[confirmation.place.audience]}. Описание, чек-лист и файлы станут доступны этой аудитории.`}
        >
          <p className="muted">
            У серии изменится и доступ следующих экземпляров. Отказ сохраняет введённые данные.
          </p>
          <button
            className="btn btn--primary btn--block"
            type="button"
            disabled={operation.pending}
            onClick={operation.confirm}
          >
            Подтвердить и передать
          </button>
          <button
            className="btn btn--secondary btn--block sheet__next"
            type="button"
            disabled={operation.pending}
            onClick={operation.cancelConfirmation}
          >
            Оставить прежний доступ
          </button>
        </Sheet>
      ) : null}
    </>
  );
}
