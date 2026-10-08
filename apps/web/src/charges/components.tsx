import { Notice } from '../auth/components.tsx';
import { type ChargeAction, chargeErrorMessage } from './errors.ts';

/** Ошибка действия с начислением или оплатой: понятный текст вместо технического сообщения. */
export function ChargeError({ error, action }: { error: unknown; action: ChargeAction }) {
  if (!error) return null;
  return <Notice error>{chargeErrorMessage(error, action)}</Notice>;
}
