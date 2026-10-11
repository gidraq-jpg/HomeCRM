import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import { ApiError, apiRequest } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { taskError } from './errors.ts';
import { MemberPicker } from './options.tsx';
/** Объект, документ и ручной срок: здесь нет протокола расширения аудитории. */
export function ResponsibleField({
  kind,
  id,
  assigneeId,
  householdId,
  canEdit,
  sourceTo,
}: {
  kind: 'objects' | 'documents' | 'deadlines';
  id: string;
  assigneeId: string | null;
  householdId: string | null;
  canEdit: boolean;
  sourceTo?: string;
}) {
  const { me } = useHousehold();
  const [value, setValue] = useState(assigneeId ?? me.id);
  useEffect(() => {
    setValue(assigneeId ?? me.id);
  }, [assigneeId, me.id]);
  const state = useAction();
  const client = useQueryClient();
  return (
    <div className="task-responsible">
      {sourceTo ? (
        <Link className="text-button" to={sourceTo}>
          Ответственный задаётся в источнике
        </Link>
      ) : canEdit ? (
        <fieldset className="task-form__fields" disabled={state.pending}>
          <MemberPicker
            label="Ответственный"
            householdId={householdId}
            value={value}
            onChange={setValue}
          />
          <p className="muted">
            Участник должен уже видеть запись. Аудитория автоматически не расширяется.
          </p>
          <button
            className="btn btn--secondary"
            type="button"
            disabled={state.disabled || value === assigneeId}
            onClick={() =>
              void state.run(async () => {
                await apiRequest('POST', `${kind}/${id}/assignee`, z.unknown(), {
                  assigneeId: value,
                });
                await Promise.all(
                  [kind, 'deadlines', 'tasks', 'files'].map((key) =>
                    client.invalidateQueries({ queryKey: [key] }),
                  ),
                );
              })
            }
          >
            Сменить ответственного
          </button>
        </fieldset>
      ) : null}
      {state.error ? (
        <Notice error>
          {state.error instanceof ApiError && state.error.code === 'ASSIGNEE_NOT_VISIBLE'
            ? 'Участник не видит запись. Выберите того, кто уже имеет доступ; аудитория не изменена.'
            : taskError(state.error)}
        </Notice>
      ) : null}
    </div>
  );
}
