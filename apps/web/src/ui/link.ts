// Ссылки в формах: сайт организации, личный кабинет, сайт поставщика. Сервер принимает только
// HTTP(S) до 2000 знаков, поэтому форма сама понятно объясняет, что не так.

export const MAX_LINK = 2000;

export const LINK_ERROR =
  'Ссылка должна начинаться с http:// или https:// и быть не длиннее 2000 знаков.';

export type LinkInput = { ok: true; url: string | null } | { ok: false };

/**
 * Ссылка из поля ввода. Пустая строка — ссылки нет. Адрес без схемы («example.ru») дополняется
 * `https://`: так его набирают на телефоне. Другие схемы (`javascript:`, `ftp:`) отклоняются.
 */
export function parseLink(input: string): LinkInput {
  const text = input.trim();
  if (text === '') return { ok: true, url: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  if (withScheme.length > MAX_LINK) return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false };
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return { ok: false };
  return { ok: true, url: withScheme };
}

/** Ссылку из ответа сервера открываем в новой вкладке, не передавая ей окно приложения. */
export const EXTERNAL_LINK = { target: '_blank', rel: 'noopener noreferrer' } as const;
