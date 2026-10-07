import { ApiError, errorMessage } from '../auth/api.ts';
import { type PluralForms, plural } from '../ui/format.ts';
import { PushError } from './push.ts';

// Тексты уведомлений — PRD, раздел 13: формы множественного числа, время «22:00–8:00» в часовом поясе дома.

const NOTIFICATIONS: PluralForms = ['уведомление', 'уведомления', 'уведомлений'];
const EN_DASH = String.fromCodePoint(0x2013);

export const KIND_LABELS: Record<string, string> = {
  deadline: 'Сроки записей',
};

export const KIND_HINTS: Record<string, string> = {
  deadline: 'Предупреждения о подходящих сроках: окно показаний, оплата, поверка, документ.',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? 'Другое';
}

/** «8:00»: час без нуля впереди, как принято в тексте. */
export function clockText(clock: string): string {
  const [hours = '', minutes = ''] = clock.split(':');
  return `${Number(hours)}:${minutes}`;
}

/** Тихие часы одной строкой: «22:00–8:00»; одинаковые начало и конец выключают интервал (ADR-0029). */
export function quietHoursText(start: string, end: string): string {
  if (start === end) return 'Тихие часы выключены';
  return `${clockText(start)}${EN_DASH}${clockText(end)}`;
}

/** «5 уведомлений в день». */
export function budgetText(count: number): string {
  return `${count} ${plural(count, NOTIFICATIONS)} в день`;
}

export type ResultTone = 'ok' | 'warning' | 'danger' | 'neutral';

/** Итог попытки отправки словами; код службы — только для ошибок. Статус — всегда текст, не один цвет. */
export function resultInfo(
  result: string,
  errorCode: number | null,
): { text: string; tone: ResultTone } {
  const code = errorCode === null ? '' : ` (код ${errorCode})`;
  switch (result) {
    case 'sent':
      return { text: 'Принято службой push', tone: 'ok' };
    case 'retry':
      return { text: `Ошибка, повторим${code}`, tone: 'warning' };
    case 'gone':
      return { text: `Устройство отключено службой${code}`, tone: 'danger' };
    case 'uncertain':
      return { text: 'Результат неизвестен, повтора не будет', tone: 'warning' };
    default:
      return { text: 'Неизвестный итог', tone: 'neutral' };
  }
}

export type NotificationAction = 'load' | 'save' | 'remove' | 'enable';

/** Тексты ошибок экранов уведомлений. Технические сообщения сервера и браузера не показываются. */
export function notificationError(error: unknown, action: NotificationAction): string {
  if (error instanceof PushError) {
    switch (error.code) {
      case 'unsupported':
        return 'Этот браузер не умеет получать push-уведомления.';
      case 'denied':
        return 'Уведомления запрещены в настройках браузера. Как их разрешить — ниже, в «Это устройство».';
      case 'dismissed':
        return 'Разрешение не выдано. Нажмите «Включить» ещё раз и выберите «Разрешить».';
      case 'not-configured':
        return 'Сервер пока не настроен для уведомлений. Обратитесь к администратору дома.';
      case 'no-worker':
        return 'Приложение ещё не готово к уведомлениям. Закройте его, откройте снова и повторите.';
      case 'subscribe-failed':
        return 'Браузер не смог подписаться на уведомления. Проверьте подключение к интернету и повторите.';
    }
  }
  if (!(error instanceof ApiError)) return errorMessage(error);
  const { status, code } = error;
  if (status === 0 || status === 429) return errorMessage(error);
  if (status === 401) return 'Вход истёк. Войдите заново.';
  if (status === 403 && code === 'HOUSE_REQUIRED')
    return 'Уведомления приходят участникам дома, а вы сейчас не состоите в доме.';
  if (status === 503)
    return 'Сервер пока не настроен для уведомлений. Обратитесь к администратору дома.';
  if (status === 404) return 'Устройства уже нет в списке. Обновите страницу.';
  if (status === 409)
    return 'Это устройство уже подключено к другому входу. Включите уведомления ещё раз.';
  if (status === 400)
    return action === 'save'
      ? 'Проверьте настройки: время в формате «часы:минуты», бюджет — целое число от 0 до 100.'
      : 'Не удалось отправить данные устройства. Включите уведомления ещё раз.';
  if (action === 'load') return 'Не удалось загрузить данные. Проверьте подключение и повторите.';
  return errorMessage(error);
}
