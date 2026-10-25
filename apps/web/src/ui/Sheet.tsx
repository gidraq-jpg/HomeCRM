import { X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, type RefObject, useCallback, useRef } from 'react';
import { motionTime, reducedMotion } from './motion.ts';
import { dismissSheet } from './sheet-gesture.ts';

// Нижняя панель на основе Radix Dialog: фокус не уходит за панель, Esc закрывает,
// заголовок и описание читаются как у диалога (WCAG 2.2 AA).

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Короткое пояснение под заголовком; читалки экрана произносят его вместе с заголовком. */
  description: string;
  children: ReactNode;
  /** Для подтверждений, которые нельзя закрыть случайным касанием по фону. */
  role?: 'dialog' | 'alertdialog';
  /** Панель на весь экран: для просмотра сканов документов (DOC-6). */
  fullScreen?: boolean;
  /** Устойчивый триггер для цепочки листов, когда предыдущая кнопка уже исчезла. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

// Цепочка листов может размонтировать предыдущий триггер до закрытия следующего.
const sheetOpeners = new WeakMap<HTMLElement, HTMLElement[]>();

function focusChain(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return [];
  const parent = active.closest<HTMLElement>('[data-sheet]');
  return [active, ...(parent ? (sheetOpeners.get(parent) ?? []) : [])];
}

/** Radix закрывает доступное дерево сразу; инертная копия дорисовывает только уход. */
function exitSheetElement(source: HTMLElement, isSheet: boolean) {
  if (document.documentElement.dataset.design !== 'studio') return;
  const reduce = reducedMotion();
  const transform = getComputedStyle(source).transform;
  const clone = source.cloneNode(true) as HTMLElement;
  clone.inert = true;
  clone.setAttribute('aria-hidden', 'true');
  clone.removeAttribute('id');
  clone.removeAttribute('data-sheet');
  clone.dataset.state = 'closed';
  clone.querySelectorAll('[id]').forEach((node) => {
    node.removeAttribute('id');
  });
  clone.style.pointerEvents = 'none';
  clone.style.animation = 'none';
  clone.style.transition = 'none';
  clone.dataset.motionGhost = '';
  document.body.append(clone);
  const animation = clone.animate(
    isSheet && !reduce
      ? [{ transform }, { transform: 'translate(-50%, 100%)' }]
      : [{ opacity: 1 }, { opacity: 0 }],
    {
      duration: motionTime(isSheet && !reduce ? 'sheet' : 'fast'),
      easing: getComputedStyle(document.documentElement).getPropertyValue(
        isSheet ? '--ease-sheet' : '--ease-out',
      ),
      fill: 'forwards',
    },
  );
  void animation.finished.then(
    () => clone.remove(),
    () => clone.remove(),
  );
}
function useSheetElementRef(
  isSheet: boolean,
  fullScreen: boolean,
  openers?: RefObject<HTMLElement[]>,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const armed = useRef(false);
  const set = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element && ref.current && armed.current && !fullScreen)
        exitSheetElement(ref.current, isSheet);
      ref.current = element;
      armed.current = false;
      if (element) {
        if (openers) sheetOpeners.set(element, openers.current);
        queueMicrotask(() => {
          if (ref.current === element) armed.current = true;
        });
      }
    },
    [isSheet, fullScreen, openers],
  );
  return [ref, set] as const;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  role,
  fullScreen = false,
  returnFocusRef,
}: SheetProps) {
  // Панели открываются не через Dialog.Trigger, поэтому Radix не знает, куда вернуть фокус:
  // запоминаем элемент, с которого панель открыли, и возвращаем фокус на него при закрытии.
  const openers = useRef<HTMLElement[]>([]);
  const [content, setContent] = useSheetElementRef(true, fullScreen, openers);
  const [, setOverlay] = useSheetElementRef(false, fullScreen);
  const drag = useRef<{ y: number; x: number; offset: number; time: number; id: number } | null>(
    null,
  );
  const resetDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    const element = content.current;
    if (element) {
      const returning = element.hasAttribute('data-dragging');
      const transform = getComputedStyle(element).transform;
      delete element.dataset.dragging;
      element.style.removeProperty('transform');
      if (returning && !reducedMotion())
        element.animate([{ transform }, { transform: 'translateX(-50%)' }], {
          duration: motionTime('sheet'),
          easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-sheet'),
        });
    }
  };
  // Сохраняем до Portal/FocusScope: они могут перевести activeElement на body.
  if (open && !openers.current.length) openers.current = focusChain();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" ref={setOverlay} />
        <Dialog.Content
          data-sheet
          ref={setContent}
          className={fullScreen ? 'sheet sheet--full' : 'sheet'}
          {...(role ? { role } : {})}
          onOpenAutoFocus={() => {
            if (!openers.current.length) openers.current = focusChain();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const activeSheet = [
              ...document.querySelectorAll('[data-sheet][data-state="open"]'),
            ].at(-1);
            const target = [...openers.current, returnFocusRef?.current].find(
              (element) => element?.isConnected && (!activeSheet || activeSheet.contains(element)),
            );
            openers.current = [];
            if (target?.isConnected) target.focus();
          }}
        >
          <div
            className="sheet__header"
            onPointerDown={(event) => {
              if (
                document.documentElement.dataset.design !== 'studio' ||
                !content.current ||
                fullScreen ||
                event.button !== 0 ||
                !event.isPrimary ||
                (event.target as Element).closest('button, a')
              )
                return;
              // Новый жест продолжает текущее положение входа или возврата.
              const transform = getComputedStyle(content.current).transform;
              const offset =
                transform === 'none' ? 0 : Math.max(0, new DOMMatrixReadOnly(transform).m42);
              content.current.dataset.motionSettled = '';
              content.current.getAnimations().forEach((animation) => {
                animation.cancel();
              });
              content.current.dataset.dragging = '';
              if (!reducedMotion())
                content.current.style.transform = `translate(-50%, ${offset}px)`;
              drag.current = {
                y: event.clientY,
                x: event.clientX,
                offset,
                time: event.timeStamp,
                id: event.pointerId,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId || !content.current) return;
              const dy = event.clientY - start.y;
              if (Math.abs(event.clientX - start.x) > Math.abs(dy) && Math.abs(dy) < 12) return;
              content.current.dataset.dragging = '';
              if (!reducedMotion())
                content.current.style.transform = `translate(-50%, ${Math.max(0, start.offset + dy)}px)`;
            }}
            onPointerUp={(event) => {
              const start = drag.current;
              const height = content.current?.getBoundingClientRect().height ?? 0;
              const close =
                start &&
                start.id === event.pointerId &&
                dismissSheet(event.clientY - start.y, height, event.timeStamp - start.time);
              if (close) {
                // Инертная копия уходит из положения под пальцем, без скачка к началу.
                if (content.current && !reducedMotion())
                  content.current.style.transform = `translate(-50%, ${Math.max(0, start.offset + event.clientY - start.y)}px)`;
                drag.current = null;
                onOpenChange(false);
              } else resetDrag();
            }}
            onPointerCancel={resetDrag}
            onLostPointerCapture={(event) => {
              if (event.target === event.currentTarget && drag.current) resetDrag();
            }}
          >
            <Dialog.Title className="sheet__title">{title}</Dialog.Title>
            <Dialog.Close className="icon-button icon-button--soft" aria-label="Закрыть">
              <X size={22} aria-hidden />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sheet__description">{description}</Dialog.Description>
          <div className="sheet__body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
