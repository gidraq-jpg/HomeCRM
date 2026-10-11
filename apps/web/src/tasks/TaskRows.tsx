import { canWrite } from '@homecrm/shared';
import { ListChecks, Star } from '@phosphor-icons/react';
import { Link } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { RowContent, RowList } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import type { TaskCard } from './api.ts';
import { formatDateOnly } from './fields.tsx';
import { OperationNotice, useTaskOperation } from './operation.tsx';
import { repeatLabel } from './repeats.tsx';
import { STATUS_LABELS } from './TaskForm.tsx';
export const taskPath = (id: string) => `/today/tasks/${id}`;
export function TaskRows({ tasks, label }: { tasks: readonly TaskCard[]; label: string }) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
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
          {tasks.map((card) => (
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
                  meta={
                    <>
                      <span className="radar-line">
                        {STATUS_LABELS[card.status]}
                        {card.planOn
                          ? ` · ${formatDateOnly(card.planOn)}${card.planTime ? `, ${card.planTime}` : ''}`
                          : ' · Без даты'}
                        {card.dueOn ? ` · крайний срок ${formatDateOnly(card.dueOn)}` : ''}
                      </span>
                      {card.repeatRule ? (
                        <span className="radar-line">{repeatLabel(card.repeatRule)}</span>
                      ) : null}
                      {card.status === 'waiting' ? (
                        <span className="radar-line">
                          Жду: {card.waitingFrom?.title ?? 'адресат недоступен'} · проверить{' '}
                          {card.checkOn ? formatDateOnly(card.checkOn) : '—'}
                        </span>
                      ) : null}
                    </>
                  }
                />
              </Link>
              {['open', 'waiting'].includes(card.status) &&
              canWrite(viewer, factsOf(card, viewer, 'task')) ? (
                <button
                  className="btn btn--secondary task-feed-item__done"
                  type="button"
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
              ) : null}
            </li>
          ))}
        </RowList>
      )}
    </>
  );
}
