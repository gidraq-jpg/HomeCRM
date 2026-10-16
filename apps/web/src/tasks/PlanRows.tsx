import { canWrite } from '@homecrm/shared';
import { Clock } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import type { FeedTaskCard } from './api.ts';
import { useTaskMembers } from './options.tsx';
import { taskPath } from './TaskRows.tsx';

export function PlanRows({
  tasks,
  label,
  today,
  pending,
  move,
  complete,
  remember,
}: {
  tasks: readonly FeedTaskCard[];
  label: string;
  today: string;
  pending: boolean;
  move: (card: FeedTaskCard) => void;
  complete: (card: FeedTaskCard) => void;
  remember: () => void;
}) {
  const location = useLocation();
  const { me, householdId } = useHousehold();
  const members = useTaskMembers(
    tasks.find((card) => card.householdId)?.householdId ?? householdId,
    tasks.some((card) => !!card.assigneeId && card.assigneeId !== me.id),
  );
  const viewer = viewerOf(me);
  return (
    <ul className="plan-rows" aria-label={label}>
      {tasks.map((card) => {
        const editable = canWrite(viewer, factsOf(card, viewer, 'task'));
        const visibility =
          card.spaceKind === 'personal'
            ? 'Личное'
            : card.audience === 'adults'
              ? 'Взрослые'
              : 'Вся семья';
        const metadata = [card.planTime, card.object?.title, visibility]
          .filter(Boolean)
          .join(' · ');
        const other = card.assigneeId && card.assigneeId !== me.id;
        return (
          <li className="plan-row" key={card.id}>
            {editable ? (
              <button
                className="icon-button plan-row__done"
                type="button"
                aria-label={`Отметить сделанным: ${card.title}`}
                disabled={pending}
                onClick={() => complete(card)}
              >
                <span
                  className={
                    card.status === 'waiting' ? 'plan-circle plan-circle--waiting' : 'plan-circle'
                  }
                />
              </button>
            ) : (
              <span className="plan-row__readonly" aria-hidden>
                <span
                  className={
                    card.status === 'waiting' ? 'plan-circle plan-circle--waiting' : 'plan-circle'
                  }
                />
              </span>
            )}
            <div className="plan-row__body">
              <Link
                className="plan-row__title"
                to={taskPath(card.id)}
                state={{ fromPlan: `${location.pathname}${location.search}` }}
                onClick={remember}
              >
                {card.title}
              </Link>
              <p className="plan-row__meta">
                {card.repeatRule ? (
                  <>
                    <span role="img" aria-label="Повторяется">
                      ↻
                    </span>{' '}
                  </>
                ) : null}
                {metadata}
              </p>
              {other ? (
                <p className="plan-row__meta">
                  →{' '}
                  {members.data?.find((person) => person.accountId === card.assigneeId)
                    ?.displayName ?? 'Участник'}
                </p>
              ) : null}
              {card.status === 'waiting' ? (
                <span className="studio-label studio-label--waiting">Жду</span>
              ) : null}
              {card.dueOn && card.dueOn < today ? (
                <span className="studio-label studio-label--overdue">Просрочено</span>
              ) : null}
            </div>
            {editable ? (
              <button
                className="icon-button"
                type="button"
                aria-label={`${card.planOn ? 'Перенести' : 'Назначить день'}: ${card.title}`}
                disabled={pending}
                onClick={() => move(card)}
              >
                <Clock size={22} aria-hidden />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
