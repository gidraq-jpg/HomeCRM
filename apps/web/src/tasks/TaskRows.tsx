import { canWrite } from '@homecrm/shared';
import { Check, ListChecks, Star } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import type { RadarItem } from '../deadlines/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { fetchLinks } from '../objects/api.ts';
import { useObjectsList } from '../objects/queries.ts';
import { formatRub } from '../ui/format.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { TaskCard } from './api.ts';
import { formatDateOnly } from './fields.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { repeatLabel } from './repeats.tsx';
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
}: {
  tasks: readonly TaskCard[];
  label: string;
  focus?: boolean;
  radar?: readonly RadarItem[];
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
  return (
    <>
      <OperationNotice operation={operation} />
      {tasks.length === 0 ? (
        <p className="muted">Дел под выбранные условия нет.</p>
      ) : (
        <RowList label={label}>
          {tasks.map((card) => {
            const done =
              ['open', 'waiting'].includes(card.status) &&
              canWrite(viewer, factsOf(card, viewer, 'task')) ? (
                <button
                  key={card.id}
                  className={
                    focus ? 'icon-button task-focus__done' : 'icon-button task-feed-item__done'
                  }
                  type="button"
                  aria-label="Выполнить"
                  disabled={operation.pending}
                  onClick={() =>
                    void operation.run({
                      path: `tasks/${card.id}/status`,
                      body: { status: 'done', expectedUpdatedAt: card.updatedAt },
                      keyed: true,
                    })
                  }
                >
                  <Check size={22} aria-hidden />
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
            return focus ? (
              <li className="focus task-focus" key={card.id}>
                <div className="task-focus__heading">
                  <span className="task-focus__tile">
                    <ListChecks size={24} aria-hidden />
                  </span>
                  <div>
                    <p className="focus__access">
                      {objectTitle ? `${objectTitle} · ` : ''}
                      <AccessBadge visibility={visibilityOf(card)} showLabel />
                    </p>
                    <h3 className="focus__title">{card.title}</h3>
                  </div>
                </div>
                <p className="focus__meta">
                  <TaskMeta card={card} />
                </p>
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
                <div className="focus__actions">
                  <Link
                    className="btn btn--primary"
                    to={taskPath(card.id)}
                    aria-label={`Открыть дело: ${card.title}`}
                  >
                    Открыть дело
                  </Link>
                  {done}
                </div>
              </li>
            ) : (
              <li className="task-feed-item" key={card.id}>
                <Link className="row" to={taskPath(card.id)}>
                  <RowContent
                    icon={
                      card.isMain ? (
                        <Star size={22} weight="fill" aria-hidden />
                      ) : (
                        <ListChecks size={22} aria-hidden />
                      )
                    }
                    title={card.title}
                    badge={visibilityOf(card)}
                    meta={<TaskMeta card={card} />}
                  />
                </Link>
                {done}
              </li>
            );
          })}
        </RowList>
      )}
    </>
  );
}
