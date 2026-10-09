import { X } from '@phosphor-icons/react';
import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, useRef } from 'react';

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
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  role,
  fullScreen = false,
}: SheetProps) {
  // Панели открываются не через Dialog.Trigger, поэтому Radix не знает, куда вернуть фокус:
  // запоминаем элемент, с которого панель открыли, и возвращаем фокус на него при закрытии.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className={fullScreen ? 'sheet sheet--full' : 'sheet'}
          {...(role ? { role } : {})}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
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
