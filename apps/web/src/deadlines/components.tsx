import { Notice } from '../auth/components.tsx';
import { type DeadlineAction, deadlineErrorMessage } from './errors.ts';

/** Ошибка действия со сроком: понятный текст вместо технического сообщения сервера. */
export function DeadlineError({ error, action }: { error: unknown; action: DeadlineAction }) {
  if (!error) return null;
  return <Notice error>{deadlineErrorMessage(error, action)}</Notice>;
}
