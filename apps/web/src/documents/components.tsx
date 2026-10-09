import { Notice } from '../auth/components.tsx';
import { type DocumentAction, documentErrorMessage } from './errors.ts';

/** Ошибка действия с документом: понятный текст вместо технического сообщения сервера. */
export function DocumentError({ error, action }: { error: unknown; action: DocumentAction }) {
  if (!error) return null;
  return <Notice error>{documentErrorMessage(error, action)}</Notice>;
}
