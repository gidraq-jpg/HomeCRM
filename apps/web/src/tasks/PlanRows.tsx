import { canWrite } from '@homecrm/shared';
import { Clock } from '@phosphor-icons/react';
import { useLocation } from 'react-router';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { Link } from '../shell/motion.tsx';
import { MotionList } from '../ui/MotionList.tsx';
import type { FeedTaskCard, TaskCard } from './api.ts';
import { CompletionCheck } from './CompletionCheck.tsx';
import { formatDateOnly } from './fields.tsx';
import { useTaskMembers } from './options.tsx';
import { isOverdue } from './plan.ts';
import { SwipeTaskRow } from './SwipeTaskRow.tsx';
import { STATUS_LABELS } from './TaskForm.tsx';
import { taskPath } from './TaskRows.tsx';

export function PlanRows<T extends TaskCard & { object?: FeedTaskCard['object'] }>({
  tasks,
  label,
  today,
  pending,
  completionFailed = false,
  move,
  complete,
  resume,
  resumeBlocked,
  remember,
  dates = false,
}: {
  tasks: readonly T[];
  label: string;
  today: string;
  pending: boolean;
  completionFailed?: boolean;
  move?: (card: T) => void;
  complete: (card: T) => void;
  resume?: (card: T) => void;
  resumeBlocked?: (card: T) => boolean;
  remember?: () => void;
  dates?: boolean;
}) {
  const location = useLocation();
  const { me, householdId } = useHousehold();
  const members = useTaskMembers(
    tasks.find((card) => card.householdId)?.householdId ?? householdId,
    !dates && tasks.some((card) => !!card.assigneeId && card.assigneeId !== me.id),
  );
  const viewer = viewerOf(me);
  return (
    <MotionList
      className="plan-rows"
      label={label}
      version={tasks.map((card) => card.id + card.status).join(',')}
    >
      {tasks.map((card) => {
        const active = ['open', 'waiting'].includes(card.status);
        const editable = canWrite(viewer, factsOf(card, viewer, 'task'));
        const closed = !active;
        const circle = (
          <span
            className={
              closed
                ? 'plan-circle plan-circle--done'
                : card.status === 'waiting'
                  ? 'plan-circle plan-circle--waiting'
                  : 'plan-circle'
            }
            aria-hidden
          >
            {closed ? <CompletionCheck /> : null}
          </span>
        );
        const visibility =
          card.spaceKind === 'personal'
            ? 'Личное'
            : card.audience === 'adults'
              ? 'Взрослые'
              : 'Вся семья';
        const metadata = [
          dates && card.planOn ? formatDateOnly(card.planOn) : null,
          card.planTime,
          card.object?.title,
          visibility,
          dates && !['open', 'waiting'].includes(card.status) ? STATUS_LABELS[card.status] : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const other = card.assigneeId && card.assigneeId !== me.id;
        return (
          <SwipeTaskRow
            className={closed ? 'plan-row plan-row--closed' : 'plan-row'}
            key={card.id}
            card={card}
            pending={pending}
            completionFailed={completionFailed}
            complete={() => complete(card)}
          >
            {editable && (active || resume) ? (
              <button
                className="icon-button plan-row__done"
                type="button"
                aria-label={`${closed ? 'Возобновить' : 'Отметить сделанным'}: ${card.title}`}
                disabled={pending || (closed && resumeBlocked?.(card))}
                onClick={() => (closed ? resume?.(card) : complete(card))}
              >
                {circle}
              </button>
            ) : (
              <span className="plan-row__readonly" aria-hidden>
                {circle}
              </span>
            )}
            <div className="plan-row__body">
              <Link
                className="plan-row__title"
                aria-label={
                  closed ? `${card.title} · ${STATUS_LABELS[card.status].toLowerCase()}` : undefined
                }
                to={taskPath(card.id)}
                state={dates ? undefined : { fromPlan: `${location.pathname}${location.search}` }}
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
              {other &&
              (!dates || members.data?.some((person) => person.accountId === card.assigneeId)) ? (
                <p className="plan-row__meta">
                  →{' '}
                  {members.data?.find((person) => person.accountId === card.assigneeId)
                    ?.displayName ?? 'Участник'}
                </p>
              ) : null}
              {card.status === 'waiting' ? (
                <span className="studio-label studio-label--waiting">Жду</span>
              ) : null}
              {dates && card.status === 'waiting' ? (
                <p className="plan-row__meta">
                  Жду: {card.waitingFrom?.title ?? 'адресат недоступен'} · проверить{' '}
                  {card.checkOn ? formatDateOnly(card.checkOn) : '—'}
                </p>
              ) : null}
              {isOverdue(card, today) ? (
                <span className="studio-label studio-label--overdue">Просрочено</span>
              ) : null}
            </div>
            {editable && active && move ? (
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
          </SwipeTaskRow>
        );
      })}
    </MotionList>
  );
}
