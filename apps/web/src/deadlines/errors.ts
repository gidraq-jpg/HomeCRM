import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API сроков (ADR-0028). Технические сообщения сервера не показываются; в
// сообщениях нет названий записей и сроков.

export type DeadlineAction = 'load' | 'create' | 'save' | 'trash' | 'zone' | 'mark' | 'verify';

/** Ошибки отметок оплаты, передачи и поверки (UTIL-13): понятный текст по коду ответа. */
function markErrorMessage(error: ApiError, action: 'mark' | 'verify'): string {
  const { status, code } = error;
  if (status === 403)
    return action === 'verify'
      ? 'Отмечать поверку этого счётчика вам нельзя: её отмечает тот, кто ведёт объект.'
      : 'Отмечать этот срок вам нельзя: его отмечает тот, кто ведёт объект.';
  if (status === 404)
    return 'Срока или счётчика больше нет, или они стали вам недоступны. Обновите страницу.';
  if (code === 'SELECT_CHARGE')
    return 'За этот месяц несколько начислений. Откройте лицевой счёт и добавьте оплату у нужного начисления.';
  if (code === 'CANCEL_PAYMENT_WITH_REASON')
    return 'По начислению оплату отменяют с причиной. Откройте лицевой счёт, раскройте «Оплаты» и отмените оплату там.';
  if (code === 'ACTIVE_METERS_EXIST')
    return 'У счёта появились счётчики: окно закроют их показания. Обновите страницу.';
  if (code === 'METER_INACTIVE')
    return 'Счётчик заменён или снят, поверка для него не проводится. Обновите страницу.';
  if (code === 'METER_TRASHED')
    return 'Счётчик в корзине. Верните его из корзины и отметьте поверку снова.';
  if (status === 409) return 'Срок изменился. Обновите страницу и повторите.';
  if (status === 400) return 'Проверьте даты: они должны быть заполнены верно.';
  return errorMessage(error);
}

export function deadlineErrorMessage(error: unknown, action: DeadlineAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (action === 'mark' || action === 'verify') return markErrorMessage(error, action);
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
