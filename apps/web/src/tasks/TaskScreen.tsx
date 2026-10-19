import { canChangeAudience, canMove, canRestore, canTrash, canWrite } from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import { VISIBILITY_LABELS, type Visibility } from '../access/visibility.ts';
import { ApiError, type Me } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { ME_KEY } from '../auth/session-cache.ts';
import { FilesSection } from '../files/FilesSection.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { useSettings } from '../notifications/queries.ts';
import { Page, Section } from '../ui/Page.tsx';
import { RecordPage } from '../ui/RecordPage.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import type { TaskCard, TimedTask } from './api.ts';
import { fetchTask, seriesAction } from './api.ts';
import { taskError } from './errors.ts';
import { formatDateOnly, SelectField } from './fields.tsx';
import { MoveTaskSheet } from './MoveTaskSheet.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { MemberPicker, useTaskMembers } from './options.tsx';
import { useRefreshTasks, useTask, useTaskHistory, useToday } from './queries.ts';
import { repeatLabel } from './repeats.tsx';
import { STATUS_LABELS, TaskForm, taskChange, taskDraft } from './TaskForm.tsx';
import { TaskLinks } from './TaskLinks.tsx';
import { taskPath } from './TaskRows.tsx';
import { useFeedActions } from './useFeedActions.ts';
export function TaskScreen() {
  const { taskId } = useParams();
  const { me } = useHousehold();
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
  return <TaskView key={`${me.id}:${taskId}`} card={query.data} />;
}
function TaskView({ card }: { card: TimedTask }) {
  const location = useLocation();
  const { me, householdId } = useHousehold();
  const client = useQueryClient();
  const refresh = useRefreshTasks();
  const settings = useSettings();
  const calendar = useToday(card.householdId);
  const feedActions = useFeedActions<TaskCard>((updated) => {
    client.setQueryData(['tasks', me.id, 'card', card.id], { ...card, ...updated });
  });
  const [actionsOpen, setActionsOpen] = useState(false);
  const facts = factsOf(card, viewerOf(me), 'task');
  const viewer = viewerOf(me);
  const targetHouse = card.householdId ?? householdId;
  const recordActions = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState<TaskCard | null>(null);
  const [editPending, setEditPending] = useState(false);
  const editRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      editRequest.current?.abort();
      editRequest.current = null;
    };
  }, []);
  const [transfer, setTransfer] = useState(false);
  const [assignee, setAssignee] = useState(card.assigneeId ?? me.id);
  const [scope, setScope] = useState('this');
  const [moving, setMoving] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>(visibilityOf(card));
  const losingMembers = useTaskMembers(
    card.spaceKind === 'household' ? card.spaceId : null,
    moving,
  );
  const narrowing =
    card.spaceKind === 'household' &&
    (visibility === 'personal' || (card.audience === 'household' && visibility === 'adults'));
  const losing = (losingMembers.data ?? []).filter(
    (member) =>
      !member.formerMember &&
      (visibility === 'personal'
        ? member.accountId !== me.id && (card.audience === 'household' || member.role !== 'child')
        : member.role === 'child'),
  );
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
  const canReschedule = active && ['open', 'waiting'].includes(card.status) && !!calendar.data;
  const reschedule = () => {
    setActionsOpen(false);
    feedActions.startMove(card);
  };
  const restore = !!card.deletedAt && canRestore(viewer, facts);
  const trash = canTrash(viewer, facts);
  const [tick, setTick] = useState(performance.now());
  useEffect(() => {
    setTick(performance.now());
    if (card.status !== 'done') return;
    const timer = window.setInterval(() => setTick(performance.now()), 200);
    return () => window.clearInterval(timer);
  }, [card.status]);
  async function beginEdit() {
    if (editRequest.current || operation.pending) return;
    const controller = new AbortController();
    editRequest.current = controller;
    setEditPending(true);
    operation.setError(null);
    const sameAccount = () => client.getQueryData<Me | null>([ME_KEY])?.id === me.id;
    try {
      await client.cancelQueries({ queryKey: ['tasks', me.id, 'card', card.id], exact: true });
      if (controller.signal.aborted || !sameAccount()) return;
      // Форма принимает содержимое и точную версию из одного snapshot, включая офлайн-чтение.
      const fresh = await fetchTask(card.id, controller.signal);
      const currentMe = client.getQueryData<Me | null>([ME_KEY]);
      if (controller.signal.aborted || currentMe?.id !== me.id) return;
      if (fresh.id !== card.id) throw new ApiError(502, 'INVALID_RESPONSE');
      client.setQueryData(['tasks', me.id, 'card', card.id], fresh);
      const currentViewer = viewerOf(currentMe);
      if (!canWrite(currentViewer, factsOf(fresh, currentViewer, 'task'))) throw new ApiError(403);
      setEditing(fresh);
    } catch (error) {
      if (!controller.signal.aborted && sameAccount()) operation.setError(error);
    } finally {
      if (editRequest.current === controller) {
        editRequest.current = null;
        setEditPending(false);
      }
    }
  }
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
    if (
      value === 'adults' &&
      losingMembers.data?.some(
        (member) =>
          member.accountId === card.assigneeId && member.role === 'child' && !member.formerMember,
      )
    )
      return false;
    const target =
      value === 'personal'
        ? { kind: 'personal' as const, ownerId: me.id, spaceId: me.personalSpaceId ?? '' }
        : { kind: 'household' as const, spaceId: targetHouse ?? '', audience: value };
    return (
      (target.kind === 'personal' || !!targetHouse) &&
      (card.spaceId === target.spaceId
        ? canChangeAudience(viewer, facts, target)
        : canMove(viewer, facts, target, card.hasOtherContributions))
    );
  });
  return (
    <RecordPage
      actionsRef={recordActions}
      actionsOpen={actionsOpen}
      onActionsOpenChange={setActionsOpen}
      editing={editing !== null}
      title={card.title}
      documentTitle="Дело"
      type={card.deletedAt ? 'Дело · в корзине' : 'Дело'}
      back={{
        to:
          typeof location.state?.fromPlan === 'string' &&
          location.state.fromPlan.startsWith('/today/plan')
            ? location.state.fromPlan
            : '/today',
        label: location.state?.fromPlan ? 'План' : 'Сегодня',
      }}
      visibility={visibilityOf(card)}
      subtitle={STATUS_LABELS[card.status]}
      onEdit={active && !editing ? () => void beginEdit() : undefined}
      editLabel="Править дело"
      editPending={editPending || operation.pending}
      onAccess={
        active && moveOptions.length
          ? () => {
              setVisibility(visibilityOf(card));
              setMoving(true);
            }
          : undefined
      }
      facts={[
        {
          label: 'План',
          value: canReschedule ? (
            <button
              className="text-button task-reschedule"
              type="button"
              onClick={reschedule}
              aria-label="Перенести план дела"
            >
              {card.planOn ? formatDateOnly(card.planOn) : 'Без даты'} {card.planTime ?? ''}
            </button>
          ) : (
            `${card.planOn ? formatDateOnly(card.planOn) : 'Без даты'} ${card.planTime ?? ''}`
          ),
        },
        {
          label: 'Крайний срок',
          value:
            canReschedule && card.dueOn ? (
              <button
                className="text-button task-reschedule"
                type="button"
                onClick={reschedule}
                aria-label="Перенести дело по дате срока"
              >
                {formatDateOnly(card.dueOn)} {card.dueTime ?? ''}
              </button>
            ) : (
              `${card.dueOn ? formatDateOnly(card.dueOn) : 'Не задан'} ${card.dueTime ?? ''}`
            ),
        },
        { label: 'Повтор', value: repeatLabel(card.repeatRule) || 'Без повтора' },
      ]}
      more={
        <>
          <div className="btn-row">
            {active ? (
              ['open', 'waiting'].includes(card.status) ? (
                <>
                  {canReschedule ? (
                    <button type="button" className="btn btn--secondary" onClick={reschedule}>
                      Перенести…
                    </button>
                  ) : null}
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
                  {card.assigneeId === me.id && settings.data?.todayMainEnabled ? (
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
              ) : null
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
          {active && card.spaceKind === 'household' && moveOptions.includes('personal') ? (
            <button
              className="btn btn--secondary list-action"
              type="button"
              onClick={() => {
                setVisibility('personal');
                setMoving(true);
              }}
            >
              Сделать личной
            </button>
          ) : null}
        </>
      }
    >
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
          {card.deletedAt ? <Notice>Дело в корзине. Правки недоступны.</Notice> : null}
          {active && ['open', 'waiting'].includes(card.status) ? (
            <div className="ui6-primary">
              <button
                type="button"
                className="btn btn--primary"
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
            </div>
          ) : null}
          {active && ['done', 'cancelled', 'not_done'].includes(card.status) ? (
            <div className="ui6-primary">
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
            </div>
          ) : null}
          <p className="task-description">{card.description || 'Описания нет.'}</p>
          <dl className="facts">
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
          <FilesSection
            compact
            parent={{ kind: 'task', id: card.id }}
            card={card}
            canAdd={active}
            refresh={refresh}
          />
          <TaskLinks card={card} />
          <History card={card} />
        </>
      )}
      {feedActions.moving && calendar.data ? (
        <MoveTaskSheet
          card={feedActions.moving}
          timeZone={calendar.data.timeZone}
          pending={feedActions.operation.pending}
          error={feedActions.operation.error}
          close={feedActions.close}
          move={feedActions.move}
        />
      ) : null}
      {transfer ? (
        <Sheet
          returnFocusRef={recordActions}
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
          returnFocusRef={recordActions}
          open
          onOpenChange={(open) => {
            if (!open) setMoving(false);
          }}
          title="Изменить доступ"
          description="Подтвердите, кто увидит дело. Файлы и следующие экземпляры серии следуют новому размещению. При чужих правках сервер может запретить перенос в личное."
        >
          <VisibilityPicker value={visibility} options={moveOptions} onChange={setVisibility} />
          <p>Новый доступ: {VISIBILITY_LABELS[visibility]}.</p>
          {narrowing ? (
            losingMembers.isSuccess && !losingMembers.isFetching ? (
              <p>
                Потеряют доступ:{' '}
                {losing.map((member) => member.displayName).join(', ') ||
                  'никто из действующих участников'}
                .
              </p>
            ) : (
              <Notice error={losingMembers.isError}>
                Не удалось подтвердить состав участников. Дождитесь загрузки или повторите её.
                <button
                  className="text-button"
                  type="button"
                  onClick={() => void losingMembers.refetch()}
                >
                  Обновить участников
                </button>
              </Notice>
            )
          ) : null}
          {card.seriesId ? (
            <p className="muted">Изменится также доступ следующих экземпляров серии.</p>
          ) : null}
          <button
            className="btn btn--primary"
            type="button"
            disabled={
              operation.pending ||
              !moveOptions.includes(visibility) ||
              (narrowing && (!losingMembers.isSuccess || losingMembers.isFetching))
            }
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
    </RecordPage>
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
  const calendar = useToday(card.householdId);
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
              {calendar.data
                ? formatMoment(event.created_at, calendar.data.timeZone)
                : 'уточняем пояс дома…'}
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
