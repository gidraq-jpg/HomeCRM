import { ApiError, errorMessage } from '../auth/api.ts';

// Тексты ответов API начислений и оплат (ADR-0034). Технические сообщения сервера не показываются;
// сумм, периодов, плательщиков и причин в них нет.

export type ChargeAction =
  | 'load'
  | 'charge'
  | 'payment'
  | 'cancel-charge'
  | 'cancel-payment'
  | 'receipt';

export function chargeErrorMessage(error: unknown, action: ChargeAction): string {
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (code === 'DUE_DATE_REQUIRED') {
    return 'Укажите срок оплаты: у лицевого счёта нет ежемесячного дня оплаты. Ничего не сохранено.';
  }
  if (code === 'CANCEL_PAYMENTS_FIRST') {
    return 'Сначала отмените оплаты этого начисления, потом отмените само начисление.';
  }
  if (code === 'CHARGE_CANCELLED') {
    return 'Начисление отменено, оплату к нему добавить нельзя. Обновите страницу.';
  }
  if (code === 'PAYMENT_TOTAL_TOO_LARGE') {
    return 'Сумма оплат получается слишком большой. Проверьте введённую сумму.';
  }
  if (status === 404) {
    return 'Лицевого счёта, начисления или файла больше нет, либо они стали вам недоступны. Обновите страницу.';
  }
  if (status === 403) {
    return 'Менять начисления и оплаты этого объекта могут только взрослые. Обновите страницу: возможно, права изменились.';
  }
  if (status === 409) return 'Данные изменились, пока вы работали. Обновите страницу и повторите.';
  if (status === 400) {
    return action === 'cancel-charge' || action === 'cancel-payment'
      ? 'Напишите причину отмены, не длиннее 2000 знаков. Ничего не отменено.'
      : 'Проверьте поля: суммы — в рублях, даты заполнены, плательщик из состава дома, файл относится к этому объекту. Ничего не сохранено.';
  }
  if (action === 'load') return 'Не удалось загрузить данные. Проверьте подключение и повторите.';
  return errorMessage(error);
}
