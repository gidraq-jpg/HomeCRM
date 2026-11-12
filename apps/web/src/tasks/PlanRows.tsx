import { canWrite } from '@homecrm/shared';
import { Clock } from '@phosphor-icons/react';
import { useId } from 'react';
import { useLocation } from 'react-router';
import type { RadarItem } from '../deadlines/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { Link } from '../shell/motion.tsx';
import { formatRub, plural } from '../ui/format.ts';
import { MotionList } from '../ui/MotionList.tsx';
import type { FeedTaskCard, TaskCard } from './api.ts';
import { CompletionCheck } from './CompletionCheck.tsx';
import { formatDateOnly } from './fields.tsx';
import { useTaskMembers } from './options.tsx';
import { overdueDays, overdueText } from './plan.ts';
import { SwipeTaskRow } from './SwipeTaskRow.tsx';
import { STATUS_LABELS } from './TaskForm.tsx';
import { taskPath } from './TaskRows.tsx';

/**
 * Единая строка дела (UI-9): «Сегодня», «План», «Все дела», «Выполнено сегодня».
 * Слева круг, в центре название и мета-строка, справа «Перенести». Доступ подписывается
 * только исключением: «Взрослые» и «→ Имя».
 */
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
  undatedAge = false,
  waitingDetail = dates,
  fromPlan = !dates,
  shortDoneLabel = false,
  todayStyle = false,
  radar = [],
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
  /** «Все дела»: в мета-строке день и статус закрытого. */
  dates?: boolean;
  undatedAge?: boolean;
  /** Показывать, от кого ждём и когда проверить. */
  waitingDetail?: boolean;
  /** Ссылка помнит, откуда пришли, чтобы вернуться на тот же экран. */
  fromPlan?: boolean;
  /** «Сегодня»: кнопка круга зовётся просто «Выполнить», как и в карточке главного дела. */
  shortDoneLabel?: boolean;
  todayStyle?: boolean;
  radar?: readonly RadarItem[];
}) {
  const location = useLocation();
  const overdueId = useId();
  const { me, householdId } = useHousehold();
  const members = useTaskMembers(
    tasks.find((card) => card.householdId)?.householdId ?? householdId,
    !dates && tasks.some((card) => !!card.assigneeId && card.assigneeId !== me.id),
  );
  const viewer = viewerOf(me);
  return (
    <MotionList
      className={todayStyle ? 'plan-rows today-rows' : 'plan-rows'}
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
                  ? 'plan-circle plan-circle--waiting task-completion-circle'
                  : 'plan-circle task-completion-circle'
            }
            aria-hidden
          >
            <CompletionCheck />
          </span>
        );
        const other = card.assigneeId && card.assigneeId !== me.id;
        const assignee =
          other && (!dates || members.data?.some((person) => person.accountId === card.assigneeId))
            ? `→ ${members.data?.find((person) => person.accountId === card.assigneeId)?.displayName ?? 'Участник'}`
            : null;
        const late = overdueDays(card, today);
        const showLateBadge = todayStyle || dates;
        const amount = todayStyle
          ? radar.find(
              (item) => item.id === card.radarOccurrenceId && item.sourceKind === 'payment',
            )?.remainingCents
          : undefined;
        const weeks = Math.floor(
          (Date.parse(`${today}T12:00:00Z`) - Date.parse(card.createdAt)) / (7 * 86400000),
        );
        const metadata = [
          undatedAge &&
          weeks >= 2 &&
          Date.parse(`${today}T12:00:00Z`) - Date.parse(card.createdAt) > 14 * 86400000
            ? `лежит ${weeks} ${new Intl.PluralRules('ru').select(weeks) === 'one' ? 'неделю' : new Intl.PluralRules('ru').select(weeks) === 'few' ? 'недели' : 'недель'}`
            : null,
          dates && card.planOn ? formatDateOnly(card.planOn) : null,
          card.planTime,
          late && !showLateBadge ? overdueText(late) : null,
          card.object?.title,
          card.spaceKind !== 'personal' && card.audience === 'adults' ? 'Взрослые' : null,
          assignee,
          card.status === 'waiting'
            ? waitingDetail
              ? `Жду: ${card.waitingFrom?.title ?? 'адресат недоступен'} · проверить ${card.checkOn ? formatDateOnly(card.checkOn) : '—'}`
              : 'Жду'
            : null,
          dates && closed ? STATUS_LABELS[card.status] : null,
        ].filter(Boolean);
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
                aria-label={
                  shortDoneLabel && !closed
                    ? 'Выполнить'
                    : `${closed ? 'Возобновить' : 'Отметить сделанным'}: ${card.title}`
                }
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
            <Link
              className="plan-row__link"
              aria-label={
                closed ? `${card.title} · ${STATUS_LABELS[card.status].toLowerCase()}` : card.title
              }
              aria-describedby={showLateBadge && late ? overdueId + card.id : undefined}
              to={taskPath(card.id)}
              state={fromPlan ? { fromPlan: `${location.pathname}${location.search}` } : undefined}
              onClick={remember}
            >
              <span className="plan-row__title">{card.title}</span>
              {metadata.length || card.repeatRule ? (
                <span
                  className={
                    late && !showLateBadge
                      ? 'plan-row__meta plan-row__meta--late'
                      : 'plan-row__meta'
                  }
                >
                  {card.repeatRule ? (
                    <>
                      <span role="img" aria-label="Повторяется">
                        ↻
                      </span>{' '}
                    </>
                  ) : null}
                  {metadata.join(' · ')}
                </span>
              ) : null}
              {showLateBadge && late ? <OverdueBadge days={late} id={overdueId + card.id} /> : null}
            </Link>
            {amount != null ? <span className="today-row__amount">{formatRub(amount)}</span> : null}
            {editable && active && move ? (
              <button
                className="icon-button plan-row__move"
                type="button"
                aria-label={`${card.planOn ? 'Перенести' : 'Назначить день'}: ${card.title}`}
                disabled={pending}
                onClick={() => move(card)}
              >
                <Clock size={24} aria-hidden />
              </button>
            ) : null}
          </SwipeTaskRow>
        );
      })}
    </MotionList>
  );
}

export function OverdueBadge({ days, id }: { days: number; id?: string }) {
  return (
    <span className="today-overdue" id={id}>
      <Clock size={14} aria-hidden />
      на {days} {plural(days, ['день', 'дня', 'дней'])} позже срока
    </span>
  );
}
