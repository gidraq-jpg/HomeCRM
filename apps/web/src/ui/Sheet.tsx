import { X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, type RefObject, useRef } from 'react';

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
  // Сохраняем до Portal/FocusScope: они могут перевести activeElement на body.
  if (open && !openers.current.length) openers.current = focusChain();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          data-sheet
          ref={(element) => {
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
          <div className="sheet__header">
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
