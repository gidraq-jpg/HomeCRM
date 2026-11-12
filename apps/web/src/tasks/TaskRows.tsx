import { canWrite } from '@homecrm/shared';
import { ListChecks } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import type { RadarItem } from '../deadlines/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { fetchLinks } from '../objects/api.ts';
import { useObjectsList } from '../objects/queries.ts';
import { Link } from '../shell/motion.tsx';
import { formatRub } from '../ui/format.ts';
import { RowList } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { TaskCard } from './api.ts';
import { formatDateOnly } from './fields.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { OverdueBadge, PlanRows } from './PlanRows.tsx';
import { overdueDays } from './plan.ts';
import { repeatLabel } from './repeats.tsx';
import { SwipeTaskRow } from './SwipeTaskRow.tsx';
import { STATUS_LABELS } from './TaskForm.tsx';
export const taskPath = (id: string) => `/today/tasks/${id}`;
function TaskMeta({ card }: { card: TaskCard }) {
  return (
    <>
      <span className="radar-line">
        {card.status === 'waiting' ? (
          <span className="studio-label studio-label--waiting">Жду</span>
        ) : (
          STATUS_LABELS[card.status]
        )}
        {card.planOn
          ? ` · ${formatDateOnly(card.planOn)}${card.planTime ? `, ${card.planTime}` : ''}`
          : ' · Без даты'}
        {card.dueOn ? ` · крайний срок ${formatDateOnly(card.dueOn)}` : ''}
      </span>
      {card.repeatRule ? <span className="radar-line">{repeatLabel(card.repeatRule)}</span> : null}
      {card.status === 'waiting' ? (
        <span className="radar-line">
          Жду: {card.waitingFrom?.title ?? 'адресат недоступен'} · проверить{' '}
          {card.checkOn ? formatDateOnly(card.checkOn) : '—'}
        </span>
      ) : null}
    </>
  );
}
export function TaskRows({
  tasks,
  label,
  focus = false,
  radar = [],
  move,
  pending = false,
  today = '',
  todayStyle = false,
}: {
  tasks: readonly TaskCard[];
  label: string;
  focus?: boolean;
  radar?: readonly RadarItem[];
  move?: (card: TaskCard) => void;
  pending?: boolean;
  /** День дома: по нему считается просрочка в мета-строке. */
  today?: string;
  todayStyle?: boolean;
}) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const objects = useObjectsList(false);
  const mainId = focus ? tasks[0]?.id : undefined;
  const links = useQuery({
    queryKey: ['links', 'task', mainId],
    enabled: !!mainId,
    queryFn: ({ signal }) => fetchLinks({ type: 'task', id: mainId ?? '' }, signal),
  });
  const toast = useToast();
  const operation = useTaskOperation((card) => {
    if (card.status === 'done') {
      const duration = card.undoUntil - performance.now();
      toast.show({
        message: 'Дело выполнено',
        ...(duration > 0 && card.completionEventId
          ? {
              durationMs: duration,
              action: {
                label: 'Отменить',
                onClick: () => {
                  if (performance.now() < card.undoUntil)
                    void operation.run({
                      path: `tasks/${card.id}/undo`,
                      body: { eventId: card.completionEventId },
                    });
                },
              },
            }
          : {}),
      });
    } else toast.show({ message: 'Дело обновлено' });
  });
  const completeCard = (card: TaskCard) =>
    void operation.run({
      path: `tasks/${card.id}/status`,
      body: { status: 'done', expectedUpdatedAt: card.updatedAt },
      keyed: true,
    });
  if (!focus)
    return (
      <>
        <OperationNotice operation={operation} />
        {tasks.length === 0 ? <p className="muted">Дел под выбранные условия нет.</p> : null}
        {tasks.length ? (
          <PlanRows
            tasks={tasks}
            label={label}
            today={today}
            todayStyle={todayStyle}
            radar={radar}
            pending={operation.pending || pending}
            completionFailed={!!operation.error || !!operation.confirmation}
            move={move}
            complete={completeCard}
            waitingDetail
            shortDoneLabel
          />
        ) : null}
      </>
    );
  return (
    <>
      <OperationNotice operation={operation} />
      {tasks.length === 0 ? <p className="muted">Дел под выбранные условия нет.</p> : null}
      <RowList label={label}>
        {tasks.map((card) => {
          const editable =
            ['open', 'waiting'].includes(card.status) &&
            canWrite(viewer, factsOf(card, viewer, 'task'));
          const late = overdueDays(card, today);
          const done = editable ? (
            <button
              key={card.id}
              className="btn btn--primary task-focus__done"
              type="button"
              disabled={operation.pending || pending}
              onClick={() => completeCard(card)}
            >
              Готово
            </button>
          ) : null;
          const reschedule =
            move && editable ? (
              <button
                key={`move-${card.id}`}
                className="btn task-focus__postpone"
                type="button"
                disabled={operation.pending || pending}
                onClick={() => move(card)}
              >
                Отложить
              </button>
            ) : null;
          const payment = radar.find(
            (item) => item.id === card.radarOccurrenceId && item.sourceKind === 'payment',
          );
          const objectIds =
            links.data?.flatMap((link) =>
              [link.left, link.right].filter((ref) => ref.type === 'object').map((ref) => ref.id),
            ) ?? [];
          const objectTitle =
            payment?.object?.title ??
            objects.data?.pages.flat().find((object) => objectIds.includes(object.id))?.title;
          return (
            <SwipeTaskRow
              className="focus task-focus"
              key={card.id}
              card={card}
              pending={operation.pending || pending}
              completionFailed={!!operation.error || !!operation.confirmation}
              complete={() => completeCard(card)}
            >
              <div className="task-focus__heading">
                <span className="task-focus__tile">
                  <ListChecks size={24} aria-hidden />
                </span>
                <div>
                  <h2 className="today-main__label">Главное на сегодня</h2>
                  <Link className="focus__title task-focus__title" to={taskPath(card.id)}>
                    {card.title}
                  </Link>
                  <p className="focus__meta">
                    {objectTitle && objectTitle !== card.title ? `${objectTitle} · ` : null}
                    {card.spaceKind !== 'personal' && card.audience === 'adults'
                      ? 'Взрослые · '
                      : null}
                    <TaskMeta card={card} />
                  </p>
                  {late ? <OverdueBadge days={late} /> : null}
                </div>
              </div>
              {payment?.remainingCents != null ? (
                <p className="task-focus__remaining">
                  осталось {formatRub(payment.remainingCents)}
                </p>
              ) : null}
              {payment?.totalCents != null &&
              payment.totalCents > 0 &&
              payment.paidCents != null ? (
                <progress
                  className="task-focus__progress"
                  aria-label="Оплаченная доля"
                  max={payment.totalCents}
                  value={Math.min(payment.totalCents, Math.max(0, payment.paidCents))}
                />
              ) : null}
              {done || reschedule ? (
                <div className="focus__actions">
                  {done}
                  {reschedule}
                </div>
              ) : null}
            </SwipeTaskRow>
          );
        })}
      </RowList>
    </>
  );
}
