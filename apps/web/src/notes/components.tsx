import { Notice } from '../auth/components.tsx';
import { type NoteAction, noteErrorMessage } from './errors.ts';

/** Ошибка действия с заметкой: понятный текст вместо технического сообщения сервера. */
export function NoteError({ error, action }: { error: unknown; action: NoteAction }) {
  if (!error) return null;
  return <Notice error>{noteErrorMessage(error, action)}</Notice>;
}
