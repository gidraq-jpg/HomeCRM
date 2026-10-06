import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов состава дома (docs/household-api.md). Технические сообщения сервера не
// показываются: они могут содержать детали запроса. Каждое объяснение говорит, что делать дальше.

export type HouseholdAction =
  | 'role'
  | 'exclude'
  | 'leave'
  | 'invite'
  | 'reset'
  | 'profile'
  | 'load';

/** Администратору нужен подтверждённый второй фактор (AUTH-3): экран объясняет, а не ругается. */
export function isSecondFactorRequired(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 403 && error.code === 'SECOND_FACTOR_REQUIRED'
  );
}

/**
 * Уход или исключение уже выполнены, но передача ответственности администратору не завершилась.
 * Периодическая очистка повторит её сама, поэтому для человека это успех с оговоркой.
 */
export function isResponsibilityPending(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 503 && error.code === 'RESPONSIBILITY_PENDING'
  );
}

export const SECOND_FACTOR_TEXT =
  'Управлять составом дома можно только со вторым фактором. Включите его в разделе «Настройки», затем повторите действие.';

export function householdErrorMessage(error: unknown, action: HouseholdAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (isSecondFactorRequired(error)) return SECOND_FACTOR_TEXT;
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 409 && code === 'LAST_ADMIN') {
    return action === 'leave'
      ? 'Вы единственный администратор, поэтому уйти из дома нельзя. Сначала назначьте администратором другого участника: откройте его карточку в разделе «Люди» и смените роль.'
      : 'В доме должен остаться хотя бы один администратор. Сначала назначьте администратором другого участника.';
  }
  if (status === 409) {
    return action === 'role'
      ? 'Роль не изменилась. Возможно, участник отвечает за записи «Взрослые»: пока ответственность не передана другому взрослому, он не может стать ребёнком. Если это не так, обновите страницу и повторите.'
      : 'Данные изменились, пока вы работали. Обновите страницу и повторите.';
  }
  if (status === 404) {
    return action === 'invite'
      ? 'Дом не найден. Обновите страницу и повторите.'
      : 'Участника уже нет в доме. Обновите страницу.';
  }
  if (status === 403) {
    if (action === 'reset')
      return 'Ссылку для сброса пароля можно выдать только ребёнку, который сейчас в доме. Пароль взрослого администратор сбросить не может.';
    return 'Это действие доступно только администратору дома.';
  }
  if (status === 400) {
    return action === 'profile'
      ? 'Проверьте данные: имя не длиннее 100 знаков, телефон — до 40, дата — настоящая.'
      : 'Не удалось выполнить действие: данные не прошли проверку.';
  }
  if (status === 503 && code === 'WORKER_UNAVAILABLE') {
    return 'Сервер сейчас не может завершить действие. Ничего не изменилось, повторите позже.';
  }
  if (action === 'load') return 'Не удалось загрузить данные. Проверьте подключение и повторите.';
  return errorMessage(error);
}
