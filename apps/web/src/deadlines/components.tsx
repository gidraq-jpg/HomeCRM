import { Notice } from '../auth/components.tsx';
import { type DeadlineAction, deadlineErrorMessage } from './errors.ts';

/** Ошибка действия со сроком: понятный текст вместо технического сообщения сервера. */
export function DeadlineError({ error, action }: { error: unknown; action: DeadlineAction }) {
  if (!error) return null;
  return <Notice error>{deadlineErrorMessage(error, action)}</Notice>;
}

/** Пересчёт сроков: пока идёт — «Идёт пересчёт», после предела опроса — просьба обновить позже. */
export function RecalculatingNotice({
  stalled,
  onRetry,
}: {
  stalled: boolean;
  onRetry: () => void;
}) {
  if (!stalled) return <Notice>Идёт пересчёт</Notice>;
  return (
    <Notice>
      <p>Пересчёт затянулся. Обновите страницу позже.</p>
      <button className="text-button" type="button" onClick={onRetry}>
        Обновить
      </button>
    </Notice>
  );
}
