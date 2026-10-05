// Заглушка этапа 0 (план, задача 0.2): проверяет, как телефоны открывают сервер и получают push.
// Здесь — разбор входных данных без сети и файлов, чтобы его было легко проверить тестами.

export const MAX_BLOB_BYTES = 8 * 1024 * 1024;
export const MAX_JSON_BYTES = 64 * 1024;
export const MAX_PUSH_DELAY_SEC = 15 * 60;
export const MAX_LABEL_LENGTH = 40;

export const NETWORKS = [
  'wifi-home',
  'wifi-other',
  'mts',
  'beeline',
  'megafon',
  't2',
  'yota',
  'mobile-other',
] as const;
export type Network = (typeof NETWORKS)[number];

export const NETWORK_LABELS: Readonly<Record<Network, string>> = {
  'wifi-home': 'Wi-Fi дома',
  'wifi-other': 'Другой Wi-Fi',
  mts: 'МТС',
  beeline: 'Билайн',
  megafon: 'МегаФон',
  t2: 'Т2',
  yota: 'Yota',
  'mobile-other': 'Другой оператор',
};

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Размер для проверки загрузки: целое число байт от 1 до 8 МиБ. */
export function parseBlobSize(raw: string | null): number | null {
  if (raw === null || !/^\d{1,8}$/.test(raw)) return null;
  const size = Number(raw);
  return size >= 1 && size <= MAX_BLOB_BYTES ? size : null;
}

/** Задержка перед тестовым push: целое число секунд от 0 до 15 минут. */
export function parseDelay(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) return null;
  return raw >= 0 && raw <= MAX_PUSH_DELAY_SEC ? raw : null;
}

/** Подпись телефона: без управляющих символов, не длиннее 40 знаков. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return 'без подписи';
  const withoutControls = Array.from(raw)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('');
  const label = Array.from(withoutControls.trim()).slice(0, MAX_LABEL_LENGTH).join('');
  return label.length > 0 ? label : 'без подписи';
}

export function parseNetwork(raw: unknown): Network | null {
  return typeof raw === 'string' && (NETWORKS as readonly string[]).includes(raw)
    ? (raw as Network)
    : null;
}

/** Подписка push от браузера: адрес службы доставки только по HTTPS и ключи в base64url. */
export function parseSubscription(raw: unknown): PushSubscriptionJson | null {
  if (!isRecord(raw) || typeof raw.endpoint !== 'string' || !isRecord(raw.keys)) return null;
  const { endpoint, keys } = raw;
  if (endpoint.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!BASE64URL.test(p256dh) || p256dh.length > 200) return null;
  if (!BASE64URL.test(auth) || auth.length > 100) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Экранирование для страницы результатов. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
