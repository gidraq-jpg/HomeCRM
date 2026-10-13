import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { ApiError, type ApiMethod, type Me } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { ME_KEY } from '../auth/session-cache.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { clearDraft } from '../offline/drafts.ts';
import { changed, LocalFailure, LocalSaved } from '../offline/identity.ts';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { fetchTask, mutateTask, TaskError, type TimedTask } from './api.ts';
import { taskError } from './errors.ts';
import { useTaskMembers } from './options.tsx';
import { useRefreshTasks } from './queries.ts';
import type { TaskDraft } from './TaskForm.tsx';
export interface TaskOperation {
  path: string;
  method?: ApiMethod;
  body: Record<string, unknown>;
  keyed?: boolean;
  draft?: TaskDraft;
}
export function useTaskOperation(onSuccess: (card: TimedTask) => void | Promise<void>) {
  const { me } = useHousehold();
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const sameAccount = () => client.getQueryData<Me | null>([ME_KEY])?.id === me.id;
  const [pending, setPending] = useState(false);
  const unresolved = useRef<{ signature: string; body: Record<string, unknown> } | null>(null);
  const locked = useRef(false);
  const key = useOperationKey();
  const refresh = useRefreshTasks();
  const [error, setError] = useState<unknown>(null);
  const [confirmation, setConfirmation] = useState<{
    request: TaskOperation;
    place: NonNullable<TaskError['suggestedPlacement']>;
  } | null>(null);
  async function run(request: TaskOperation) {
    if (locked.current || !sameAccount()) return;
    locked.current = true;
    setPending(true);
    setError(null);
    const { idempotencyKey: _key, ...fields } = request.body;
    const signature = JSON.stringify({ path: request.path, body: fields });
    let body = request.body;
    try {
      if (unresolved.current && unresolved.current.signature !== signature)
        throw new LocalFailure('ALREADY_SENT');
      body =
        unresolved.current?.body ??
        (request.keyed
          ? {
              ...request.body,
              idempotencyKey:
                request.body.idempotencyKey ?? key({ path: request.path, body: request.body }),
            }
          : request.body);
      let result = await mutateTask(
        request.path,
        body,
        request.method,
        request.draft ? { key: `form:${location.pathname}`, value: request.draft } : undefined,
      );
      if (!sameAccount()) return;
      if (
        (request.path.endsWith('/status') && request.body.status === 'open') ||
        (request.method === 'PATCH' && request.body.repeatScope === 'following')
      ) {
        // Обычные online open/following не несут exact version: принимаем целый согласованный GET.
        result = await fetchTask(result.id);
        if (!sameAccount()) return;
      }
      // Ответ старого GET не должен затереть подтверждённую мутацию или отмену.
      await client.cancelQueries({ queryKey: ['tasks', me.id] });
      if (!sameAccount()) return;
      setConfirmation(null);
      unresolved.current = null;
      await clearDraft(`form:${location.pathname}`).catch(() => changed('storage-error'));
      if (mounted.current) await onSuccess(result);
      // Блокировка защищает отправку мутации; актуализация не расходует окно отмены.
      void refresh();
    } catch (failure) {
      if (!sameAccount()) return;
      if (failure instanceof TaskError && failure.code === 'OUTCOME_UNKNOWN' && failure.intentId) {
        unresolved.current = { signature, body };
      }
      if (failure instanceof LocalSaved && request.path === 'tasks') {
        await clearDraft(`form:${location.pathname}`).catch(() => changed('storage-error'));
        navigate('/more/offline');
        return;
      }
      if (
        failure instanceof TaskError &&
        failure.code === 'ASSIGNEE_NOT_VISIBLE' &&
        failure.suggestedPlacement
      )
        setConfirmation({ request, place: failure.suggestedPlacement });
      else {
        const reported =
          request.path.endsWith('/undo') &&
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.code === 'CONFLICT'
            ? new ApiError(409, 'UNDO_CONFLICT')
            : failure;
        setError(reported);
        if (request.path.endsWith('/undo')) toast.show({ message: taskError(reported) });
        if (failure instanceof ApiError && failure.status === 409) void refresh();
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
