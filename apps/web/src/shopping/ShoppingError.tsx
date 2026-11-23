import { ApiError, errorMessage } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';

export function ShoppingError({ error }: { error: unknown }) {
  if (!error) return null;
  const text =
    error instanceof ApiError && error.status === 404
      ? 'Покупка или связанная запись недоступна. Обновите список.'
      : error instanceof ApiError && error.status === 409
        ? 'Позиция изменилась на другом устройстве. Ваш ввод сохранён.'
        : errorMessage(error);
  return <Notice error>{text}</Notice>;
}
