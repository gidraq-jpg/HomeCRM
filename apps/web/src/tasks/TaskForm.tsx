import {
  type TaskFields as Fields,
  TaskData,
  TaskDataWithMissingTarget,
  TaskFields,
  TaskRepeatRule,
} from '@homecrm/shared';
import { type FormEvent, useId, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { defaultVisibility } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, viewerOf, visibilityOf } from '../notes/abilities.ts';
import type { TaskCard } from './api.ts';
import { ChecklistEditor } from './ChecklistEditor.tsx';
import { SelectField, TextField } from './fields.tsx';
import { MemberPicker, RecordPicker, useOptions, useTaskMembers } from './options.tsx';
import { RepeatFields } from './repeats.tsx';
export const STATUS_LABELS: Record<TaskCard['status'], string> = {
  open: 'Открыто',
  done: 'Выполнено',
  cancelled: 'Отменено',
  not_done: 'Не сделано',
  waiting: 'Жду',
};
export interface TaskDraft extends Omit<Fields, 'planOn' | 'dueOn' | 'checkOn'> {
  planOn: string | null;
  dueOn: string | null;
  checkOn: string | null;
  assigneeId: string;
  objectId: string;
  householdId: string;
  visibility: Visibility;
  repeatScope: 'this' | 'following';
}
export function taskDraft(card: TaskCard, visibility: Visibility): TaskDraft {
  return {
    ...TaskFields.strip().parse(card),
    assigneeId: card.assigneeId ?? '',
    objectId: '',
    householdId: card.householdId ?? '',
    visibility,
    repeatScope: 'this',
  };
}
/** Обычная правка не пересылает скрытого адресата как null и не меняет расписание серии. */
export function taskChange(draft: TaskDraft, base: TaskCard): Record<string, unknown> {
  const fields = TaskFields.strip().parse(draft);
  const change: Record<string, unknown> = {
    expectedUpdatedAt: base.updatedAt,
    repeatScope: draft.repeatScope,
  };
  for (const [key, value] of Object.entries(fields))
    if (JSON.stringify(value) !== JSON.stringify(base[key as keyof TaskCard])) change[key] = value;
  if (draft.assigneeId !== base.assigneeId) change.assigneeId = draft.assigneeId;
  return change;
}
export function TaskForm({
  initial,
  base,
  pending,
  onSubmit,
  onCancel,
}: {
  initial: TaskDraft;
  base?: TaskCard;
  pending: boolean;
  onSubmit: (draft: TaskDraft) => void;
  onCancel: () => void;
}) {
  const { me } = useHousehold();
  const { scope } = useScope();
  const objects = useOptions('object', !base);
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState('');
  const descriptionId = useId();
  function update<K extends keyof TaskDraft>(key: K, value: TaskDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = TaskFields.strip().safeParse(draft);
    if (!parsed.success) {
      setInvalid('Проверьте название, даты и параметры чек-листа.');
      return;
    }
    const fields = parsed.data;
    const hiddenTarget =
      base?.status === 'waiting' &&
      !base.waitingFrom &&
      !draft.waitingAccountId &&
      !draft.waitingContactId;
    if (!(hiddenTarget ? TaskDataWithMissingTarget : TaskData).safeParse(fields).success) {
      setInvalid(
        'Проверьте даты, время и адресата ожидания. Для «Жду» нужны адресат и дата проверки; для повтора — начальная дата.',
      );
      return;
    }
    if (draft.repeatRule && !TaskRepeatRule.safeParse(draft.repeatRule).success) {
      setInvalid('Проверьте параметры повтора.');
      return;
    }
    if (
      base?.repeatRule &&
      JSON.stringify(draft.repeatRule) !== JSON.stringify(base.repeatRule) &&
      draft.repeatScope !== 'following'
    ) {
      setInvalid('Правило повтора и его прекращение меняются только для «Это и следующие».');
      return;
    }
    setInvalid('');
    onSubmit(draft);
  }
  const options = creatableVisibilities(viewerOf(me), draft.householdId || null, 'task');
  return (
    <form className="task-form" onSubmit={submit}>
      <fieldset disabled={pending} className="task-form__fields">
        <TextField
          label="Название дела"
          value={draft.title}
          required
          maxLength={200}
          onChange={(value) => update('title', value)}
        />
        <div className="field">
          <label htmlFor={descriptionId} className="field__label">
            Описание
          </label>
          <textarea
            className="input"
            id={descriptionId}
            maxLength={20000}
            value={draft.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </div>
        {!base ? (
          <SelectField
            label="Дом для дат"
            value={draft.householdId}
            onChange={(value) => update('householdId', value)}
            options={[
              { value: '', label: 'Выберите дом' },
              ...me.roles.map((role, index) => ({
                value: role.householdId,
                label: `Дом ${index + 1}`,
              })),
            ]}
          />
        ) : null}
        <p className="muted">Даты и точное время — в часовом поясе дома.</p>
        <div className="task-fields">
          <TextField
            label={draft.repeatRule ? 'Начальная дата / план' : 'Дата плана'}
            type="date"
            value={draft.planOn ?? ''}
            required={!!draft.repeatRule}
            onChange={(value) => {
              update('planOn', value || null);
              if (!value) update('planTime', null);
            }}
          />
          <TextField
            label="Время плана"
            type="time"
            value={draft.planTime ?? ''}
            onChange={(value) => update('planTime', value || null)}
            disabled={!draft.planOn}
          />
        </div>
        <div className="task-fields">
          <TextField
            label="Крайний срок"
            type="date"
            value={draft.dueOn ?? ''}
            onChange={(value) => {
              update('dueOn', value || null);
              if (!value) update('dueTime', null);
            }}
          />
          <TextField
            label="Время крайнего срока"
            type="time"
            value={draft.dueTime ?? ''}
            onChange={(value) => update('dueTime', value || null)}
            disabled={!draft.dueOn}
          />
        </div>
        <MemberPicker
          householdId={draft.householdId || null}
          value={draft.assigneeId}
          onChange={(value) => update('assigneeId', value)}
        />
        <SelectField
          label="Статус"
          value={draft.status}
          onChange={(value) => update('status', value as Fields['status'])}
          options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        {draft.status === 'waiting' ? (
          <fieldset>
            <legend>Ожидание</legend>
            {base?.status === 'waiting' && !base.waitingFrom ? (
              <p className="muted">
                Прежний адресат недоступен. Обычная правка сохранит связь; выбрать нового можно
                явно.
              </p>
            ) : null}
            <WaitingMemberPicker
              householdId={draft.householdId || null}
              value={draft.waitingAccountId ?? ''}
              onChange={(value) => {
                update('waitingAccountId', value || null);
                if (value) update('waitingContactId', null);
              }}
            />
            <RecordPicker
              label="Жду от контакта"
              kind="contact"
              value={draft.waitingContactId ?? ''}
              selectedTitle={base?.waitingFrom?.title}
              onChange={(value) => {
                update('waitingContactId', value || null);
                if (value) update('waitingAccountId', null);
              }}
            />
            <TextField
              label="Дата проверки"
              type="date"
              required
              value={draft.checkOn ?? ''}
              onChange={(value) => update('checkOn', value || null)}
            />
          </fieldset>
        ) : null}
        <ChecklistEditor value={draft.checklist} onChange={(value) => update('checklist', value)} />
        {base?.seriesId ? (
          <>
            <SelectField
              label="Область правки серии"
              value={draft.repeatScope}
              onChange={(value) => update('repeatScope', value as TaskDraft['repeatScope'])}
              options={[
                { value: 'this', label: 'Только это дело' },
                ...(!base.nextTaskId && ['open', 'waiting'].includes(base.status)
                  ? [{ value: 'following', label: 'Это и следующие' }]
                  : []),
              ]}
            />
            <p className="muted">
              «Это и следующие» доступно только текущему экземпляру; прежнее дело можно править
              отдельно.
            </p>
          </>
        ) : null}
        <RepeatFields
          rule={draft.repeatRule}
          policy={draft.overduePolicy}
          onRule={(value) => update('repeatRule', value)}
          onPolicy={(value) => update('overduePolicy', value)}
        />
        {!base ? (
          <RecordPicker
            kind="object"
            label="Объект дела"
            value={draft.objectId}
            onChange={(value) => {
              update('objectId', value);
              const object = objects.data?.pages.flat().find((object) => object.id === value);
              if (!visibilityTouched)
                update(
                  'visibility',
                  defaultVisibility('task', scope, object ? { parent: visibilityOf(object) } : {}),
                );
            }}
          />
        ) : null}
        {!base ? (
          <VisibilityPicker
            value={draft.visibility}
            options={options}
            onChange={(value) => {
              setVisibilityTouched(true);
              update('visibility', value);
            }}
          />
        ) : null}
        {invalid ? <Notice error>{invalid}</Notice> : null}
        <div className="btn-row">
          <button type="submit" className="btn btn--primary">
            {pending ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCancel}>
            Отмена
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function WaitingMemberPicker({
  householdId,
  value,
  onChange,
}: {
  householdId: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const { me } = useHousehold();
  const members = useTaskMembers(householdId);
  return (
    <SelectField
      label="Жду от участника"
      value={value}
      onChange={onChange}
      options={[
        { value: '', label: 'Не выбрано' },
        { value: me.id, label: me.displayName },
        ...(members.data ?? [])
          .filter((member) => !member.formerMember && member.accountId !== me.id)
          .map((member) => ({ value: member.accountId, label: member.displayName })),
        ...(value && value !== me.id && !members.data?.some((member) => member.accountId === value)
          ? [{ value, label: 'Прежний адресат' }]
          : []),
      ]}
    />
  );
}
