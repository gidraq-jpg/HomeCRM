import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API сроков (ADR-0028). Технические сообщения сервера не показываются; в
// сообщениях нет названий записей и сроков.

export type DeadlineAction = 'load' | 'create' | 'save' | 'trash' | 'zone';

export function deadlineErrorMessage(error: unknown, action: DeadlineAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 404) {
    return 'Записи или срока больше нет, или они стали вам недоступны. Обновите страницу.';
  }
  if (status === 403) {
    return action === 'zone'
      ? 'Менять часовой пояс дома может только администратор.'
      : 'Менять сроки этой записи вам нельзя. Обновите страницу: возможно, права изменились.';
  }
  if (status === 400) {
    if (code === 'HOUSE_REQUIRED')
      return 'Срок личной записи считается по часовому поясу дома, а вы сейчас не состоите в доме.';
    return action === 'zone'
      ? 'Выберите часовой пояс из списка.'
      : 'Проверьте срок: даты, числа и время должны быть заполнены верно.';
  }
  if (status === 409) return 'Срок уже изменили или удалили. Обновите страницу и повторите.';
  if (action === 'load') return 'Не удалось загрузить сроки. Проверьте подключение и повторите.';
  return errorMessage(error);
}
