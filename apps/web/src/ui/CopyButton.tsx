import { Copy } from '@phosphor-icons/react';
import { useToast } from './Toast.tsx';

/**
 * Копирует текст в буфер обмена. `navigator.clipboard` есть только на защищённых адресах
 * (HTTPS и localhost), поэтому для простого http в домашней сети — запасной путь.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {
    console.warn('Clipboard API refused the write, trying the legacy way', error);
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  try {
    return document.execCommand('copy');
  } catch (error) {
    console.warn('Legacy copy failed', error);
    return false;
  } finally {
    field.remove();
  }
}

interface CopyButtonProps {
  value: string;
  /** Что копируем: «номер документа», «телефон». */
  what: string;
}

/** Номер копируется одним касанием — прямо из карточки и результата поиска (DOC-6, SRCH-3). */
export function CopyButton({ value, what }: CopyButtonProps) {
  const toast = useToast();
  return (
    <button
      type="button"
      className="icon-button icon-button--soft"
      aria-label={`Скопировать ${what}`}
      onClick={async () => {
        const copied = await copyText(value);
        toast.show({
          message: copied ? `Скопировано: ${what}` : 'Не удалось скопировать',
          detail: copied ? value : 'Выделите номер и скопируйте его вручную.',
        });
      }}
    >
      <Copy size={22} aria-hidden />
    </button>
  );
}
