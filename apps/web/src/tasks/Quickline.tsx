import { type CalendarDate, calendarInstant, parseQuickline, TaskFields } from '@homecrm/shared';
import { X } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { defaultVisibility, VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { ApiError } from '../auth/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { formatDateOnly } from './fields.tsx';
import { createBody } from './NewTaskScreen.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { useOptions, useTaskMembers } from './options.tsx';
import { uniqueTasks } from './queries.ts';

const labels = { date: 'Дата', time: 'Время', assignee: 'Исполнитель', object: 'Объект' };
type Kind = keyof typeof labels;
export function quickDraft(
  raw: string,
  result: ReturnType<typeof parseQuickline>,
  excluded: ReadonlySet<string>,
  overrides: Partial<Record<Kind, string>>,
) {
  const fragments = result.fragments.filter(
    (fragment) => !excluded.has(`${fragment.kind}:${fragment.text}`),
  );
  let title = raw;
  for (const fragment of [...fragments].sort((a, b) => b.start - a.start))
    title = `${title.slice(0, fragment.start)} ${title.slice(fragment.end)}`;
  const value = (kind: Kind) =>
    overrides[kind] ?? fragments.find((fragment) => fragment.kind === kind)?.value ?? null;
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    planOn: value('date'),
    planTime: value('time'),
    assigneeId: value('assignee'),
    objectId: value('object'),
    fragments,
  };
}
export function Quickline({
  householdId,
  timeZone,
  today,
  onCreated,
}: {
  householdId: string | null;
  timeZone: string;
  today: CalendarDate;
  onCreated?: () => void;
}) {
  const { me } = useHousehold();
  const { scope } = useScope();
  const navigate = useNavigate();
  const members = useTaskMembers(householdId);
  const objects = useOptions('object');
  const options = uniqueTasks(objects.data?.pages.flat() ?? []);
  const [raw, setRaw] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [choosingVisibility, setChoosingVisibility] = useState(false);
  const inputId = useId();
  const result = parseQuickline(raw, {
    now: calendarInstant(today, timeZone),
    timeZone,
    members: (members.data ?? [])
      .filter((member) => !member.formerMember)
      .map((member) => ({ id: member.accountId, name: member.displayName })),
    objects: options.map((object) => ({ id: object.id, name: object.title })),
  });
  const draft = quickDraft(raw, result, excluded, {});
  const object = options.find((object) => object.id === draft.objectId);
  const who =
    visibility ?? defaultVisibility('task', scope, object ? { parent: visibilityOf(object) } : {});
  const operation = useTaskOperation((card) => {
    setRaw('');
    setExcluded(new Set());
    onCreated?.();
    navigate(`/today/tasks/${card.id}`);
  });
  return (
    <Section title="Быстро добавить">
      <form
        className="task-form task-quickline"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.title || operation.pending) return;
          const parsed = TaskFields.safeParse({
            title: draft.title,
            planOn: draft.planOn,
            planTime: draft.planTime,
          });
          if (!parsed.success || (draft.planTime && !draft.planOn)) {
            operation.setError(new ApiError(400, 'INVALID_QUICKLINE'));
            return;
          }
          void operation.run({
            path: 'tasks',
            body: createBody(
              {
                ...parsed.data,
                planOn: draft.planOn,
                planTime: draft.planTime,
                assigneeId: draft.assigneeId ?? me.id,
                objectId: draft.objectId ?? '',
                householdId: householdId ?? '',
                visibility: who,
                repeatScope: 'this',
              },
              me.personalSpaceId,
            ),
            keyed: true,
          });
        }}
      >
        <fieldset disabled={operation.pending} className="task-form__fields">
          <div className="field">
            <label className="visually-hidden" htmlFor={inputId}>
              Быстрая строка
            </label>
            <textarea
              id={inputId}
              className="textarea"
              rows={2}
              value={raw}
              maxLength={500}
              onChange={(event) => {
                setRaw(event.target.value);
                setExcluded(new Set());
              }}
            />
          </div>
          <p className="muted">Поняли так · нажмите, чтобы убрать</p>
          <div className="task-chips">
            {draft.fragments.map((fragment) => (
              <span className={`task-chip task-chip--${fragment.kind}`} key={fragment.kind}>
                <button
                  className="text-button"
                  type="button"
                  aria-label={`Снять чип: ${labels[fragment.kind]}`}
                  aria-describedby={`${inputId}-${fragment.kind}`}
                  onClick={() => {
                    setExcluded(
                      (current) => new Set([...current, `${fragment.kind}:${fragment.text}`]),
                    );
                  }}
                >
                  <span id={`${inputId}-${fragment.kind}`}>
                    {fragment.kind === 'date'
                      ? formatDateOnly(fragment.value)
                      : fragment.kind === 'time'
                        ? fragment.value
                        : fragment.text.replace(/^[@#]/, '')}
                  </span>
                  <X size={14} aria-hidden />
                </button>
              </span>
            ))}
          </div>
          {raw ? (
            <>
              <div className="quickline-result" aria-live="polite">
                <span className="muted">Получится</span>
                <strong>{draft.title || 'Укажите название'}</strong>
                <span>
                  {draft.planOn ? formatDateOnly(draft.planOn) : 'Без даты'}
                  {draft.planTime ? `, ${draft.planTime}` : ''}
                  {draft.assigneeId
                    ? ` · исполнитель ${draft.assigneeId === me.id ? me.displayName : (members.data?.find((person) => person.accountId === draft.assigneeId)?.displayName ?? 'участник дома')}`
                    : ''}
                </span>
              </div>
              <button
                type="button"
                className="quickline-visibility"
                onClick={() => setChoosingVisibility(true)}
              >
                Кто видит: {VISIBILITY_LABELS[who]}
              </button>
              <Sheet
                open={choosingVisibility}
                onOpenChange={setChoosingVisibility}
                title="Кто видит дело"
                description="Выберите доступ перед добавлением дела"
              >
                <VisibilityPicker
                  value={who}
                  onChange={(value) => {
                    setVisibility(value);
                    setChoosingVisibility(false);
                  }}
                  options={
                    householdId
                      ? me.roles.find((role) => role.householdId === householdId)?.role === 'child'
                        ? ['personal', 'household']
                        : undefined
                      : ['personal']
                  }
                />
              </Sheet>
            </>
          ) : null}
          <button type="submit" className="btn btn--primary" disabled={!draft.title}>
            {operation.pending ? 'Добавляем…' : 'Добавить дело'}
          </button>
        </fieldset>
      </form>
      <OperationNotice operation={operation} />
      {objects.hasNextPage ? (
        <button
          type="button"
          className="text-button"
          onClick={() => void objects.fetchNextPage()}
          disabled={objects.isFetchingNextPage}
        >
          Загрузить ещё объекты для #
        </button>
      ) : null}
    </Section>
  );
}
