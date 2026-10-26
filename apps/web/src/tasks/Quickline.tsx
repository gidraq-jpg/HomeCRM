import { type CalendarDate, calendarInstant, parseQuickline, TaskFields } from '@homecrm/shared';
import { CalendarBlank, CaretRight, Clock, House, Users, X } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { defaultVisibility, VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { AiCapture } from '../ai/AiCapture.tsx';
import { ApiError } from '../auth/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { useNavigate } from '../shell/motion.tsx';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { DictationButton, DictationStatus, useDictation } from '../voice/Dictation.tsx';
import { appendDictation } from '../voice/recognition.ts';
import { formatDateOnly, TextField } from './fields.tsx';
import { createBody } from './NewTaskScreen.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { MemberPicker, RecordPicker, useOptions, useTaskMembers } from './options.tsx';
import { uniqueTasks } from './queries.ts';

const labels = { date: 'Дата', time: 'Время', assignee: 'Исполнитель', object: 'Объект' };
const actions = { date: 'дату', time: 'время', assignee: 'исполнителя', object: 'объект' };
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
  const [overrides, setOverrides] = useState<Partial<Record<Kind, string>>>({});
  const [editing, setEditing] = useState<Kind | null>(null);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [choosingVisibility, setChoosingVisibility] = useState(false);
  const inputId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  // TASK-2: надиктованное дописывается в поле; разбирается и сохраняется так же, как набранное.
  const dictation = useDictation((text) => {
    if (!text.trim()) return undefined;
    setRaw((current) => appendDictation(current, text).slice(0, 500));
    setExcluded(new Set());
    setOverrides({});
    return undefined;
  });
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.style.height = 'auto';
    if (!raw) return;
    input.style.height = `${input.scrollHeight + 2}px`;
  }, [raw]);
  const result = parseQuickline(raw, {
    now: calendarInstant(today, timeZone),
    timeZone,
    members: (members.data ?? [])
      .filter((member) => !member.formerMember)
      .map((member) => ({ id: member.accountId, name: member.displayName })),
    objects: options.map((object) => ({ id: object.id, name: object.title })),
  });
  const draft = quickDraft(raw, result, excluded, overrides);
  const object = options.find((object) => object.id === draft.objectId);
  const assignee =
    draft.assigneeId === me.id
      ? me.displayName
      : members.data?.find((person) => person.accountId === draft.assigneeId)?.displayName;
  const who =
    visibility ?? defaultVisibility('task', scope, object ? { parent: visibilityOf(object) } : {});
  const operation = useTaskOperation((card) => {
    setRaw('');
    setExcluded(new Set());
    setOverrides({});
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
          // Сохраняется то, что видно в поле; поздний итог записи не попадёт в очищенное поле.
          dictation.abort();
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
            <div className="voice-line">
              <textarea
                ref={field}
                id={inputId}
                className="textarea"
                rows={1}
                value={raw}
                maxLength={500}
                onChange={(event) => {
                  setRaw(event.currentTarget.value);
                  setExcluded(new Set());
                  setOverrides({});
                }}
              />
              <DictationButton dictation={dictation} />
              <AiCapture
                key={householdId}
                text={raw}
                house={householdId}
                place={who}
                beforeExtract={dictation.abort}
              />
            </div>
          </div>
          <DictationStatus dictation={dictation} />
          <p className="muted">Поняли так · нажмите, чтобы изменить</p>
          <div className="task-chips">
            {draft.fragments.map((fragment) => {
              const value = overrides[fragment.kind] ?? fragment.value;
              const text =
                fragment.kind === 'date'
                  ? value
                    ? formatDateOnly(value)
                    : 'Не выбрано'
                  : fragment.kind === 'assignee'
                    ? (assignee ?? 'Участник недоступен')
                    : fragment.kind === 'object'
                      ? (object?.title ?? 'Не выбрано')
                      : value || 'Не выбрано';
              return (
                <span className={`task-chip task-chip--${fragment.kind}`} key={fragment.kind}>
                  <button
                    className="text-button"
                    type="button"
                    aria-label={`Изменить ${actions[fragment.kind]}: ${text}`}
                    onClick={() => setEditing(fragment.kind)}
                  >
                    {fragment.kind === 'date' ? (
                      <CalendarBlank size={16} aria-hidden />
                    ) : fragment.kind === 'time' ? (
                      <Clock size={16} aria-hidden />
                    ) : fragment.kind === 'object' ? (
                      <House size={16} aria-hidden />
                    ) : (
                      <span className="task-chip__avatar" aria-hidden>
                        {text.slice(0, 1)}
                      </span>
                    )}
                    <span>{text}</span>
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Убрать ${actions[fragment.kind]}: ${text}`}
                    onClick={() => {
                      setExcluded(
                        (current) => new Set([...current, `${fragment.kind}:${fragment.text}`]),
                      );
                      setOverrides((current) => {
                        const next = { ...current };
                        delete next[fragment.kind];
                        return next;
                      });
                    }}
                  >
                    <X size={14} aria-hidden />
                  </button>
                </span>
              );
            })}
          </div>
          {raw ? (
            <>
              <div className="quickline-result" aria-live="polite">
                <span className="muted">Получится</span>
                <strong>{draft.title || 'Укажите название'}</strong>
                <span>
                  {draft.planOn ? formatDateOnly(draft.planOn) : 'Без даты'}
                  {draft.planTime ? `, ${draft.planTime}` : ''}
                  {draft.assigneeId ? ` · исполнитель ${assignee ?? 'участник дома'}` : ''}
                  {object ? ` · ${object.title}` : ''}
                </span>
              </div>
              <button
                type="button"
                className="quickline-visibility"
                onClick={() => setChoosingVisibility(true)}
              >
                <Users size={20} aria-hidden />
                <span>Кто видит: {VISIBILITY_LABELS[who]}</span>
                <CaretRight size={18} aria-hidden />
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
      {editing ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          title={`Править чип: ${labels[editing]}`}
          description="Значение изменится до сохранения дела."
        >
          {editing === 'date' || editing === 'time' ? (
            <TextField
              label={labels[editing]}
              type={editing === 'date' ? 'date' : 'time'}
              value={String(
                overrides[editing] ??
                  draft.fragments.find((fragment) => fragment.kind === editing)?.value ??
                  '',
              )}
              onChange={(value) => setOverrides((current) => ({ ...current, [editing]: value }))}
            />
          ) : editing === 'assignee' ? (
            <MemberPicker
              householdId={householdId}
              value={draft.assigneeId ?? me.id}
              onChange={(value) => setOverrides((current) => ({ ...current, assignee: value }))}
            />
          ) : (
            <RecordPicker
              kind="object"
              label="Объект"
              value={draft.objectId ?? ''}
              onChange={(value) => setOverrides((current) => ({ ...current, object: value }))}
            />
          )}
          <button type="button" className="btn btn--primary" onClick={() => setEditing(null)}>
            Готово
          </button>
        </Sheet>
      ) : null}
    </Section>
  );
}
