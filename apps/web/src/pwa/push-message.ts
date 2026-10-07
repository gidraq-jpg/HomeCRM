// Разбор содержимого push для сервис-воркера. Чистые функции без обращений к окну и воркеру:
// их проверяют модульные тесты. Содержимое push нигде не сохраняется и не пишется в консоль.

/** Текст, когда в push нет ничего пригодного: то же, что сервер шлёт при скрытии текста (NOTIF-6). */
export const FALLBACK_TEXT = 'В HomeCRM есть новое';
export const DEFAULT_TITLE = 'HomeCRM';
const TITLE_LIMIT = 100;
const BODY_LIMIT = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PushDescription {
  title: string;
  body: string;
  /** Одинаковый тег заменяет прежнее уведомление, а не копит новые: одна запись — одно уведомление. */
  tag: string;
  /** Идентификатор записи или `null`: только после проверки формата. */
  recordId: string | null;
}

function text(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, limit) : null;
}

/** `raw` — результат `event.data.json()` или текст; любая другая форма даёт безопасный запасной вариант. */
export function describePush(raw: unknown): PushDescription {
  const data = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const recordId =
    typeof data.recordId === 'string' && UUID.test(data.recordId)
      ? data.recordId.toLowerCase()
      : null;
  const kind = text(data.kind, 40)?.replace(/[^a-z0-9_-]/gi, '') || 'news';
  return {
    title: text(data.title, TITLE_LIMIT) ?? DEFAULT_TITLE,
    body:
      text(data.body, BODY_LIMIT) ??
      text(data.text, BODY_LIMIT) ??
      text(raw, BODY_LIMIT) ??
      FALLBACK_TEXT,
    tag: recordId ? `${kind}-${recordId}` : kind,
    recordId,
  };
}

/** Данные push как есть: JSON, простой текст или ничего. Ошибка разбора не выходит наружу. */
export function parsePushData(read: { json(): unknown; text(): string } | null): unknown {
  if (!read) return null;
  try {
    return read.json();
  } catch {
    // Не JSON — значит, служба прислала простой текст; его показываем как есть.
    try {
      return read.text();
    } catch {
      return null;
    }
  }
}

/** Маршрут приложения (часть адреса после «#»), куда ведёт нажатие на уведомление. */
export function targetRoute(recordId: string | null): string {
  return recordId ? `/open/${recordId}` : '/more/radar';
}

/** Сообщение страницы «открой этот маршрут»: сервис-воркер шлёт его уже открытому окну. */
export const OPEN_MESSAGE = 'homecrm:open';

/** Проверка маршрута из сообщения воркера: только известные формы, никаких произвольных адресов. */
export function safeRoute(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value === '/more/radar') return value;
  const match = /^\/open\/(.+)$/.exec(value);
  return match?.[1] && UUID.test(match[1]) ? value : null;
}
