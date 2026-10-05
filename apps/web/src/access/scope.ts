import type { Visibility } from './visibility.ts';

// Переключатель «Всё · Общее · Личное» — PRD, SPACE-5 и раздел 7.4. Он фильтрует все разделы,
// выбор запоминается на устройстве, по умолчанию — «Всё».

export const SCOPES = ['all', 'shared', 'personal'] as const;
export type Scope = (typeof SCOPES)[number];

export const DEFAULT_SCOPE: Scope = 'all';

export const SCOPE_LABELS: Readonly<Record<Scope, string>> = {
  all: 'Всё',
  shared: 'Общее',
  personal: 'Личное',
};

export function isScope(value: unknown): value is Scope {
  return typeof value === 'string' && (SCOPES as readonly string[]).includes(value);
}

/** «Всё» показывает всё доступное; «Общее» — записи дома (обе аудитории); «Личное» — только личные. */
export function matchesScope(visibility: Visibility, scope: Scope): boolean {
  if (scope === 'all') return true;
  return scope === 'personal' ? visibility === 'personal' : visibility !== 'personal';
}

export function filterByScope<T extends { visibility: Visibility }>(
  items: readonly T[],
  scope: Scope,
): T[] {
  return items.filter((item) => matchesScope(item.visibility, scope));
}

/** Минимум от `localStorage`, чтобы логику можно было проверить без браузера. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SCOPE_STORAGE_KEY = 'homecrm.scope';

/** Хранилище браузера или `null`, если его нет (сервер, тесты) или оно закрыто настройками. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch (error) {
    console.warn('Browser storage is blocked, the scope switch will not be remembered', error);
    return null;
  }
}

export function loadScope(storage: KeyValueStorage | null): Scope {
  if (storage === null) return DEFAULT_SCOPE;
  try {
    const stored = storage.getItem(SCOPE_STORAGE_KEY);
    return isScope(stored) ? stored : DEFAULT_SCOPE;
  } catch (error) {
    console.warn('Cannot read the saved scope, falling back to the default', error);
    return DEFAULT_SCOPE;
  }
}

export function saveScope(storage: KeyValueStorage | null, scope: Scope): void {
  if (storage === null) return;
  try {
    storage.setItem(SCOPE_STORAGE_KEY, scope);
  } catch (error) {
    console.warn('Cannot save the scope, it will be forgotten after reload', error);
  }
}

export function clearScope(storage: KeyValueStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(SCOPE_STORAGE_KEY);
  } catch (error) {
    console.warn('Cannot clear the saved scope', error);
  }
}
