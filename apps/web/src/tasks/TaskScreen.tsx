import { canChangeAudience, canMove, canRestore, canTrash, canWrite } from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { FilesSection } from '../files/FilesSection.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import type { TaskCard, TimedTask } from './api.ts';
import { seriesAction } from './api.ts';
import { taskError } from './errors.ts';
import { formatDateOnly, SelectField } from './fields.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { MemberPicker, useTaskMembers } from './options.tsx';
import { useRefreshTasks, useTask, useTaskHistory } from './queries.ts';
import { repeatLabel } from './repeats.tsx';
import { STATUS_LABELS, TaskForm, taskChange, taskDraft } from './TaskForm.tsx';
import { TaskLinks } from './TaskLinks.tsx';
import { taskPath } from './TaskRows.tsx';
export function TaskScreen() {
  const { taskId } = useParams();
  const query = useTask(taskId);
  if (!query.data)
    return (
      <Page title="Дело" back={{ to: '/today', label: 'Сегодня' }}>
        {query.isPending ? (
          <Notice>Загружаем дело…</Notice>
        ) : (
          <Notice error>
            {taskError(query.error)}
            <button type="button" className="text-button" onClick={() => void query.refetch()}>
              Повторить загрузку дела
            </button>
          </Notice>
        )}
      </Page>
    );
  return <TaskView key={taskId} card={query.data} />;
}
function TaskView({ card }: { card: TimedTask }) {
  const { me, householdId } = useHousehold();
  const client = useQueryClient();
  const refresh = useRefreshTasks();
  const facts = factsOf(card, viewerOf(me), 'task');
  const viewer = viewerOf(me);
  const targetHouse = card.householdId ?? householdId;
  const [editing, setEditing] = useState<TaskCard | null>(null);
  const [transfer, setTransfer] = useState(false);
  const [assignee, setAssignee] = useState(card.assigneeId ?? me.id);
  const [scope, setScope] = useState('this');
  const [moving, setMoving] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(visibilityOf(card));
  const [seriesPending, setSeriesPending] = useState(false);
  const seriesLocked = useRef(false);
  const [seriesError, setSeriesError] = useState<unknown>(null);
  const operation = useTaskOperation((result) => {
    client.setQueryData(['tasks', me.id, 'card', card.id], result);
    setEditing(null);
    setTransfer(false);
    setMoving(false);
  });
  const active = canWrite(viewer, facts);
  const restore = !!card.deletedAt && canRestore(viewer, facts);
  const trash = canTrash(viewer, facts);
  const [tick, setTick] = useState(performance.now());
  useEffect(() => {
    setTick(performance.now());
    if (card.status !== 'done') return;
    const timer = window.setInterval(() => setTick(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [card.status]);
  async function series(action: 'trash' | 'restore') {
    if (seriesLocked.current) return;
    seriesLocked.current = true;
    setSeriesPending(true);
    setSeriesError(null);
    try {
      await seriesAction(card.id, action);
      await refresh();
    } catch (error) {
      setSeriesError(error);
      await refresh();
    } finally {
      seriesLocked.current = false;
      setSeriesPending(false);
    }
  }
  const moveOptions = (['personal', 'adults', 'household'] as const).filter((value) => {
    const target =
      value === 'personal'
        ? { kind: 'personal' as const, ownerId: me.id, spaceId: me.personalSpaceId ?? '' }
        : { kind: 'household' as const, spaceId: targetHouse ?? '', audience: value };
    return (
      (target.kind === 'personal' || !!targetHouse) &&
      (card.spaceId === target.spaceId
        ? canChangeAudience(viewer, facts, target)
        : canMove(viewer, facts, target))
    );
  });
  return (
    <Page title={card.title} documentTitle="Дело" back={{ to: '/today', label: 'Сегодня' }}>
      <OperationNotice operation={operation} />
      {seriesError ? <Notice error>{taskError(seriesError)}</Notice> : null}
      {editing ? (
        <>
          <TaskForm
            initial={taskDraft(editing, visibilityOf(editing))}
            base={editing}
            pending={operation.pending}
            onSubmit={(draft) => {
              const body = taskChange(draft, editing);
              if (Object.keys(body).length === 2) {
                setEditing(null);
                return;
              }
              void operation.run({
                path: `tasks/${card.id}`,
                method: 'PATCH',
                body,
                keyed: true,
              });
            }}
            onCancel={() => setEditing(null)}
          />
          {operation.error ? (
            <>
              <p className="muted">
                Текущая серверная версия: {card.title}; {STATUS_LABELS[card.status]}; чек-лист{' '}
                {card.checklist
                  .map((item) => `${item.title}: ${item.done ? 'выполнен' : 'открыт'}`)
                  .join(', ')}
                . Черновик выше сохранён.
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => {
                  setEditing(null);
                  operation.setError(null);
                  void refresh();
                }}
              >
                Отбросить черновик и обновить
              </button>
            </>
          ) : null}
        </>
      ) : (
        <>
          <p className="property-meta">
            <AccessBadge visibility={visibilityOf(card)} showLabel />
            <strong>{STATUS_LABELS[card.status]}</strong>
          </p>
          {card.deletedAt ? <Notice>Дело в корзине. Правки недоступны.</Notice> : null}
          <p className="task-description">{card.description || 'Описания нет.'}</p>
          <dl className="facts">
            <div className="facts__item">
              <dt>План</dt>
              <dd>
                {card.planOn ? formatDateOnly(card.planOn) : 'Без даты'} {card.planTime}
              </dd>
            </div>
            <div className="facts__item">
              <dt>Крайний срок</dt>
              <dd>
                {card.dueOn ? formatDateOnly(card.dueOn) : 'Не задан'} {card.dueTime}
              </dd>
            </div>
            <div className="facts__item">
              <dt>Повтор</dt>
              <dd>{repeatLabel(card.repeatRule) || 'Без повтора'}</dd>
            </div>
            {card.status === 'waiting' ? (
              <div className="facts__item">
                <dt>Жду</dt>
                <dd>
                  {card.waitingFrom?.title ?? 'Адресат недоступен'} · проверить{' '}
                  {card.checkOn ? formatDateOnly(card.checkOn) : 'дату'}
                </dd>
              </div>
            ) : null}
          </dl>
          <TaskAssignee card={card} />
          {card.checklist.length ? (
            <Section title="Чек-лист">
              <ul className="task-list">
                {[...card.checklist]
                  .sort((a, b) => a.position - b.position)
                  .map((item) => (
                    <li key={item.id}>
                      <label className="task-check-row">
                        <input
                          type="checkbox"
                          checked={item.done}
                          disabled={!active || operation.pending}
                          onChange={(event) =>
                            void operation.run({
                              path: `tasks/${card.id}`,
                              method: 'PATCH',
                              body: {
                                checklist: card.checklist.map((row) =>
                                  row.id === item.id ? { ...row, done: event.target.checked } : row,
                                ),
                                expectedUpdatedAt: card.updatedAt,
                              },
                              keyed: true,
                            })
                          }
                        />
                        <span>{item.title}</span>
                      </label>
                    </li>
                  ))}
              </ul>
            </Section>
          ) : null}
          <div className="btn-row">
            {active ? (
              <>
                <button type="button" className="btn btn--primary" onClick={() => setEditing(card)}>
                  Править дело
                </button>
                {['open', 'waiting'].includes(card.status) ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={operation.pending}
                      onClick={() =>
                        void operation.run({
                          path: `tasks/${card.id}/status`,
                          body: { status: 'done', expectedUpdatedAt: card.updatedAt },
                          keyed: true,
                        })
                      }
                    >
                      Выполнить
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => {
                        setAssignee(card.assigneeId ?? me.id);
                        setTransfer(true);
                      }}
                    >
                      Передать…
                    </button>
                    {card.assigneeId === me.id ? (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={operation.pending}
                        onClick={() =>
                          void operation.run({
                            path: `tasks/${card.id}/main`,
                            body: { selected: !card.isMain },
                          })
                        }
                      >
                        {card.isMain ? 'Снять главное' : 'Сделать главным'}
                      </button>
                    ) : null}
                  </>
                ) : null}
                {card.status === 'done' &&
                card.completionEventId &&
                !card.completionUndoneAt &&
                tick < card.undoUntil ? (
                  <button
                    className="btn btn--primary"
                    type="button"
                    disabled={operation.pending}
                    onClick={() =>
                      void operation.run({
                        path: `tasks/${card.id}/undo`,
                        body: { eventId: card.completionEventId },
                      })
                    }
                  >
                    Отменить выполнение ({Math.ceil((card.undoUntil - tick) / 1000)} с)
                  </button>
                ) : null}
                {['done', 'cancelled', 'not_done'].includes(card.status) ? (
                  <button
                    className="btn btn--secondary"
                    type="button"
                    disabled={
                      operation.pending || (card.status === 'done' && tick < card.undoUntil + 2000)
                    }
                    onClick={() =>
                      void operation.run({
                        path: `tasks/${card.id}/status`,
                        body: { status: 'open', expectedUpdatedAt: card.updatedAt },
                        keyed: true,
                      })
                    }
                  >
                    Возобновить дело
                  </button>
                ) : null}
              </>
            ) : null}
            {trash ? (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={operation.pending || seriesPending}
                  onClick={() => void operation.run({ path: `tasks/${card.id}/trash`, body: {} })}
                >
                  В корзину это дело
                </button>
                {card.seriesId ? (
                  <button
                    className="btn btn--secondary"
                    type="button"
                    disabled={operation.pending || seriesPending}
                    onClick={() => void series('trash')}
                  >
                    В корзину всю серию
                  </button>
                ) : null}
              </>
            ) : null}
            {restore ? (
              <>
                <button
                  className="btn btn--primary"
                  type="button"
                  disabled={operation.pending || seriesPending}
                  onClick={() => void operation.run({ path: `tasks/${card.id}/restore`, body: {} })}
                >
                  Восстановить это дело
                </button>
                {card.seriesId ? (
                  <button
                    className="btn btn--secondary"
                    type="button"
                    disabled={operation.pending || seriesPending}
                    onClick={() => void series('restore')}
                  >
                    Восстановить серию
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {card.nextTaskId ? (
            <p className="muted">
              Этот экземпляр уже имеет следующее дело.{' '}
              <Link className="text-button" to={taskPath(card.nextTaskId)}>
                Открыть следующий экземпляр
              </Link>
              . Возобновление после окна отмены сохраняет его.
            </p>
          ) : null}
          {active && moveOptions.length ? (
            <button
              className="btn btn--secondary list-action"
              type="button"
              onClick={() => {
                setVisibility(visibilityOf(card));
                setMoving(true);
              }}
            >
              Размещение и аудитория…
            </button>
          ) : null}
          <FilesSection
            parent={{ kind: 'task', id: card.id }}
            card={card}
            canAdd={active}
            refresh={refresh}
          />
          <TaskLinks card={card} />
          <History card={card} />
        </>
      )}
      {transfer ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setTransfer(false);
          }}
          title="Передать дело"
          description="Выберите исполнителя. Если ему нужен более широкий доступ, приложение попросит отдельное подтверждение."
        >
          <MemberPicker
            householdId={card.householdId ?? householdId}
            value={assignee}
            onChange={setAssignee}
          />
          {card.seriesId ? (
            <SelectField
              label="Передача серии"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'this', label: 'Только это дело' },
                ...(!card.nextTaskId ? [{ value: 'following', label: 'Это и следующие' }] : []),
              ]}
            />
          ) : null}
          <button
            className="btn btn--primary"
            type="button"
            disabled={operation.pending}
            onClick={() => {
              setTransfer(false);
              void operation.run({
                path: `tasks/${card.id}`,
                method: 'PATCH',
                body: {
                  assigneeId: assignee,
                  repeatScope: scope,
                  expectedUpdatedAt: card.updatedAt,
                },
                keyed: true,
              });
            }}
          >
            Передать выбранному
          </button>
        </Sheet>
      ) : null}
      {moving ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setMoving(false);
          }}
          title="Изменить доступ"
          description="Подтвердите, кто увидит дело. Файлы и следующие экземпляры серии следуют новому размещению. При чужих правках сервер может запретить перенос в личное."
        >
          <VisibilityPicker value={visibility} options={moveOptions} onChange={setVisibility} />
          <p>
            Новый доступ: {VISIBILITY_LABELS[visibility]}. Прежняя аудитория может потерять доступ.
          </p>
          <button
            className="btn btn--primary"
            type="button"
            disabled={operation.pending || !moveOptions.includes(visibility)}
            onClick={() =>
              void operation.run({
                path: `tasks/${card.id}/move`,
                body: {
                  spaceId: visibility === 'personal' ? me.personalSpaceId : targetHouse,
                  ...(visibility === 'personal' ? {} : { audience: visibility }),
                  confirmed: true,
                },
              })
            }
          >
            Подтвердить перенос
          </button>
        </Sheet>
      ) : null}
    </Page>
  );
}
function TaskAssignee({ card }: { card: TaskCard }) {
  const { me, householdId } = useHousehold();
  const members = useTaskMembers(card.householdId ?? householdId);
  return (
    <p className="muted">
      Исполнитель:{' '}
      {card.assigneeId === me.id
        ? 'Вы'
        : (members.data?.find((person) => person.accountId === card.assigneeId)?.displayName ??
          'участник дома')}
    </p>
  );
}
function History({ card }: { card: TaskCard }) {
  const { me, householdId } = useHousehold();
  const members = useTaskMembers(card.householdId ?? householdId);
  const query = useTaskHistory(card.id);
  const name = (id: unknown) =>
    id === me.id
      ? 'вы'
      : (members.data?.find((member) => member.accountId === id)?.displayName ?? 'участник');
  return (
    <Section title="История дела">
      {query.isPending ? <Notice>Загружаем историю…</Notice> : null}
      {query.error ? (
        <Notice error>
          {taskError(query.error)}
          <button type="button" className="text-button" onClick={() => void query.refetch()}>
            Обновить историю
          </button>
        </Notice>
      ) : null}
      <ul className="task-history">
        {query.data?.map((event) => (
          <li key={event.id}>
            <p>
              {event.actor_id ? name(event.actor_id) : 'Фоновая обработка'} ·{' '}
              {formatMoment(event.created_at, me.timeZone)}
            </p>
            {Object.entries(event.changes)
              .filter(([key]) =>
                [
                  'status',
                  'assignee_id',
                  'task_resumed',
                  'waiting_changed',
                  'deleted_at',
                  'repeat_rule',
                  'checklist',
                ].includes(key),
              )
              .map(([key, value]) => {
                const change = value as { old?: unknown; new?: unknown };
                return (
                  <p className="muted" key={key}>
                    {key === 'status'
                      ? `Статус: ${STATUS_LABELS[change.old as TaskCard['status']] ?? '—'} → ${STATUS_LABELS[change.new as TaskCard['status']] ?? '—'}`
                      : key === 'assignee_id' && change.old
                        ? `Передача: ${name(change.old)} → ${name(change.new)}`
                        : key === 'task_resumed'
                          ? 'Возобновлено'
                          : key === 'waiting_changed'
                            ? 'Изменено ожидание'
                            : key === 'deleted_at'
                              ? 'Изменено состояние корзины'
                              : key === 'repeat_rule'
                                ? 'Изменено расписание'
                                : key === 'checklist'
                                  ? 'Изменён чек-лист'
                                  : 'Дело создано'}
                  </p>
                );
              })}
            {Object.keys(event.changes).some(
              (key) =>
                ![
                  'status',
                  'assignee_id',
                  'task_resumed',
                  'waiting_changed',
                  'deleted_at',
                  'repeat_rule',
                  'checklist',
                ].includes(key),
            ) ? (
              <p className="muted">Изменены поля дела.</p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
