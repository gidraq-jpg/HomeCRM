import { Notice } from '../auth/components.tsx';
import { type ObjectAction, objectErrorMessage } from './errors.ts';

/** Ошибка действия с объектом: понятный текст вместо технического сообщения сервера. */
export function ObjectError({ error, action }: { error: unknown; action: ObjectAction }) {
  if (!error) return null;
  return <Notice error>{objectErrorMessage(error, action)}</Notice>;
}
