import { type CalendarDate, calendarInstant, parseQuickline, TaskFields } from '@homecrm/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { defaultVisibility, type Visibility } from '../access/visibility.ts';
import { ApiError } from '../auth/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { formatDateOnly, TextField } from './fields.tsx';
import { createBody } from './NewTaskScreen.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { MemberPicker, RecordPicker, useOptions, useTaskMembers } from './options.tsx';
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
}: {
  householdId: string | null;
  timeZone: string;
  today: CalendarDate;
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
  const who =
    visibility ?? defaultVisibility('task', scope, object ? { parent: visibilityOf(object) } : {});
  const operation = useTaskOperation((card) => {
    setRaw('');
    setExcluded(new Set());
    setOverrides({});
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
          <TextField
            label="Быстрая строка"
            value={raw}
            maxLength={500}
            onChange={(value) => {
              setRaw(value);
              setExcluded(new Set());
              setOverrides({});
            }}
          />
          <p className="muted task-quickline__hint">
            Например: «Позвонить завтра в 10:00 @Борис #Квартира». Неизвестное останется в названии.
          </p>
          <div className="task-chips">
            {draft.fragments.map((fragment) => (
              <span className="task-chip" key={fragment.kind}>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setEditing(fragment.kind)}
                >
                  {labels[fragment.kind]}:{' '}
                  {fragment.kind === 'date'
                    ? (overrides.date ?? fragment.value)
                      ? formatDateOnly(overrides.date ?? fragment.value)
                      : 'Не выбрано'
                    : fragment.kind === 'assignee' && overrides.assignee !== undefined
                      ? overrides.assignee === me.id
                        ? me.displayName
                        : (members.data?.find((person) => person.accountId === overrides.assignee)
                            ?.displayName ?? 'Участник недоступен')
                      : fragment.kind === 'object' && overrides.object !== undefined
                        ? (options.find((item) => item.id === overrides.object)?.title ??
                          'Не выбрано')
                        : (overrides[fragment.kind] ?? fragment.text)}
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Снять чип: ${labels[fragment.kind]}`}
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
                  ×
                </button>
              </span>
            ))}
          </div>
          {raw ? (
            <>
              <p className="muted task-quickline__title">
                Название: {draft.title || 'Укажите название'}
              </p>
              <VisibilityPicker
                value={who}
                onChange={setVisibility}
                options={
                  householdId
                    ? me.roles.find((role) => role.householdId === householdId)?.role === 'child'
                      ? ['personal', 'household']
                      : undefined
                    : ['personal']
                }
              />
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
