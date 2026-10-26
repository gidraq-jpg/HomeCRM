import { canTrash, canWrite } from '@homecrm/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { reducedMotion } from '../ui/motion.ts';
import type { TaskCard } from './api.ts';
import { rowSwipeDirection, rowSwipeResult, type SwipePoint } from './swipe.ts';
import { useTaskSwipeActions } from './TaskSwipeActions.tsx';

export function SwipeTaskRow({
  card,
  children,
  className,
  complete,
  pending = false,
  completionFailed = false,
}: {
  card: TaskCard;
  children: ReactNode;
  className: string;
  complete?: () => void;
  pending?: boolean;
  completionFailed?: boolean;
}) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const actions = useTaskSwipeActions();
  const facts = factsOf(card, viewer, 'task');
  const trash = !!actions && canTrash(viewer, facts);
  const done = !!complete && ['open', 'waiting'].includes(card.status) && canWrite(viewer, facts);
  const disabled = pending || !!actions?.pending;
  const row = useRef<HTMLLIElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<(SwipePoint & { id: number; direction: number; base: number }) | null>(null);
  const swallow = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [completing, setCompleting] = useState(false);
  useEffect(() => {
    if (completionFailed) setCompleting(false);
  }, [completionFailed]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: новая версия завершает локальное подтверждение, в том числе после отмены.
  useEffect(() => setCompleting(false), [card.updatedAt]);
  const closed = offset === 0;
  const draw = (x: number) => {
    if (surface.current)
      surface.current.style.transform = reducedMotion() ? '' : `translateX(${x}px)`;
  };
  const settle = (x: number) => {
    setOffset(x);
    setDragging(false);
    drag.current = null;
    draw(x);
  };
  const perform = (direction: number) => {
    settle(0);
    if (disabled) return;
    if (direction < 0 && trash) actions?.trash(card);
    if (direction > 0 && done) {
      setCompleting(true);
      if (row.current) row.current.dataset.motionCompleted = 'true';
      complete?.();
    }
  };
  return (
    <li
      ref={row}
      className="swipe-task"
      data-motion-key={card.id}
      data-motion-completed={completing}
      data-swipe-open={offset < 0 ? 'trash' : offset > 0 ? 'done' : undefined}
    >
      <div className="swipe-task__actions" inert={closed} aria-hidden={closed || undefined}>
        {done ? (
          <button
            className="swipe-task__action swipe-task__action--done"
            type="button"
            tabIndex={offset > 0 ? 0 : -1}
            hidden={offset <= 0}
            disabled={disabled}
            onClick={() => perform(1)}
          >
            Выполнено
          </button>
        ) : null}
        {trash ? (
          <button
            className="swipe-task__action swipe-task__action--trash"
            type="button"
            tabIndex={offset < 0 ? 0 : -1}
            hidden={offset >= 0}
            disabled={disabled}
            onClick={() => perform(-1)}
          >
            В корзину
          </button>
        ) : null}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: группа содержит ссылку и самостоятельные действия, это не поля формы */}
      <div
        role="group"
        aria-label={`Дело: ${card.title}`}
        ref={surface}
        className={`${className} swipe-task__surface`}
        data-dragging={dragging || undefined}
        onPointerDown={(event) => {
          if (row.current) delete row.current.dataset.rowGesture;
          swallow.current = false;
          if (
            disabled ||
            event.button !== 0 ||
            !event.isPrimary ||
            !(event.target instanceof Element) ||
            event.target.closest('button, input, textarea, select, [contenteditable]')
          )
            return;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            time: event.timeStamp,
            id: event.pointerId,
            direction: 0,
            base: offset,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const direction = rowSwipeDirection(
            start,
            { x: event.clientX, y: event.clientY, time: event.timeStamp },
            window.innerWidth,
          );
          if (!start.direction && Math.abs(event.clientY - start.y) > 12 && !direction) {
            drag.current = null;
            return;
          }
          if (!direction && !start.direction) return;
          // После горизонтального захвата вкладки не получают остаток этого жеста.
          event.stopPropagation();
          if (row.current) row.current.dataset.rowGesture = '';
          start.direction = direction || start.direction;
          swallow.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          const x = start.base + event.clientX - start.x;
          if (row.current) row.current.dataset.swipeDirection = x < 0 ? 'trash' : 'done';
          draw(
            Math.max(
              trash ? -(row.current?.clientWidth ?? 0) : 0,
              Math.min(done ? (row.current?.clientWidth ?? 0) : 0, x),
            ),
          );
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          if (!start.direction) {
            drag.current = null;
            return;
          }
          event.stopPropagation();
          const distance = start.base + event.clientX - start.x;
          const direction = distance < 0 ? -1 : 1;
          const result = rowSwipeResult(
            distance,
            row.current?.clientWidth ?? 0,
            event.timeStamp - start.time,
            event.clientX - start.x,
          );
          if ((direction < 0 && !trash) || (direction > 0 && !done)) settle(0);
          else if (result === 'action') perform(direction);
          else settle(result === 'reveal' ? direction * 104 : 0);
        }}
        onPointerCancel={() => settle(offset)}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget && drag.current) settle(offset);
        }}
        onDragStart={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (swallow.current) {
            swallow.current = false;
            event.preventDefault();
            event.stopPropagation();
          } else if (offset) {
            settle(0);
            event.preventDefault();
            event.stopPropagation();
          } else if (
            (event.target as Element).closest(
              '.plan-row__done, .task-feed-item__done, .task-focus__done',
            )
          ) {
            setCompleting(true);
            if (row.current) row.current.dataset.motionCompleted = 'true';
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') settle(0);
        }}
      >
        {children}
      </div>
    </li>
  );
}
