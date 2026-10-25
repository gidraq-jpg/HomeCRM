import { X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, type RefObject, useRef } from 'react';
import { reducedMotion } from './motion.ts';
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
  const content = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ y: number; x: number; time: number; id: number } | null>(null);
  const resetDrag = () => {
    drag.current = null;
    if (content.current) {
      delete content.current.dataset.dragging;
      content.current.style.removeProperty('transform');
    }
  };
  // Сохраняем до Portal/FocusScope: они могут перевести activeElement на body.
  if (open && !openers.current.length) openers.current = focusChain();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          data-sheet
          ref={(element) => {
            content.current = element;
            if (element) sheetOpeners.set(element, openers.current);
          }}
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
                fullScreen ||
                event.button !== 0 ||
                !event.isPrimary ||
                (event.target as Element).closest('button, a')
              )
                return;
              drag.current = {
                y: event.clientY,
                x: event.clientX,
                time: event.timeStamp,
                id: event.pointerId,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId || !content.current) return;
              const dy = Math.max(0, event.clientY - start.y);
              if (Math.abs(event.clientX - start.x) > dy && dy < 12) return;
              content.current.dataset.dragging = '';
              if (!reducedMotion()) content.current.style.transform = `translate(-50%, ${dy}px)`;
            }}
            onPointerUp={(event) => {
              const start = drag.current;
              const height = content.current?.getBoundingClientRect().height ?? 0;
              const close =
                start &&
                start.id === event.pointerId &&
                dismissSheet(event.clientY - start.y, height, event.timeStamp - start.time);
              resetDrag();
              if (close) onOpenChange(false);
            }}
            onPointerCancel={resetDrag}
            onLostPointerCapture={resetDrag}
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
