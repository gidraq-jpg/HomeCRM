/** Цветовые темы (UI-11, ADR-0052): набор токенов поверх тех же экранов. */
export const THEMES = ['studio', 'mono', 'ios'] as const;
export type ThemeId = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeId = 'studio';
export const THEME_STORAGE_KEY = 'homecrm.theme';

export const THEME_LABELS: Readonly<Record<ThemeId, string>> = {
  studio: 'Studio',
  mono: 'Монохром',
  ios: 'iOS',
};

export const THEME_HINTS: Readonly<Record<ThemeId, string>> = {
  studio: 'Тёплая палитра по умолчанию',
  mono: 'Белый фон, чёрный текст и кнопки',
  ios: 'Серый фон, белые карточки, синий акцент',
};

/** Цвет строки состояния и адресной строки браузера по теме. */
export const THEME_COLORS: Readonly<Record<ThemeId, string>> = {
  studio: '#20201e',
  mono: '#ffffff',
  ios: '#f2f2f7',
};

export function parseTheme(value: unknown): ThemeId {
  return THEMES.find((theme) => theme === value) ?? DEFAULT_THEME;
}

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch (error) {
    // В приватном режиме и при заблокированных данных сайта доступ к хранилищу бросает.
    console.warn('Theme storage is unavailable', error);
    return null;
  }
}

/** Сохранённая тема; неизвестное значение, пустое и недоступное хранилище дают Studio. */
export function readTheme(storage: ThemeStorage | null = browserStorage()): ThemeId {
  if (!storage) return DEFAULT_THEME;
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch (error) {
    console.warn('Theme could not be read', error);
    return DEFAULT_THEME;
  }
}

/** Ставит тему на страницу сразу, без перезагрузки. */
export function applyTheme(theme: ThemeId, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', THEME_COLORS[theme]);
}

/** Применяет выбор и запоминает его на устройстве; ошибка хранилища не отменяет применение. */
export function setTheme(theme: ThemeId, storage: ThemeStorage | null = browserStorage()): void {
  applyTheme(theme);
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    console.warn('Theme could not be saved', error);
  }
}
