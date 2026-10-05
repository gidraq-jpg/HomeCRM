import { describe, expect, it, vi } from 'vitest';
import {
  clearScope,
  DEFAULT_SCOPE,
  filterByScope,
  isScope,
  type KeyValueStorage,
  loadScope,
  matchesScope,
  SCOPE_LABELS,
  SCOPE_STORAGE_KEY,
  SCOPES,
  saveScope,
} from './scope.ts';
import type { Visibility } from './visibility.ts';

interface Item {
  id: string;
  visibility: Visibility;
}

const ITEMS: readonly Item[] = [
  { id: 'мой паспорт', visibility: 'personal' },
  { id: 'договор с УК', visibility: 'adults' },
  { id: 'ключи от дачи', visibility: 'household' },
  { id: 'заметка о подарке', visibility: 'personal' },
];

const ids = (items: readonly Item[]) => items.map((item) => item.id);

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('переключатель «Всё · Общее · Личное»', () => {
  it('порядок и подписи — как в PRD, по умолчанию «Всё»', () => {
    expect(SCOPES.map((scope) => SCOPE_LABELS[scope])).toEqual(['Всё', 'Общее', 'Личное']);
    expect(DEFAULT_SCOPE).toBe('all');
  });

  it('«Всё» оставляет все записи', () => {
    expect(ids(filterByScope(ITEMS, 'all'))).toEqual(ids(ITEMS));
  });

  it('«Общее» оставляет обе аудитории и убирает личное', () => {
    expect(ids(filterByScope(ITEMS, 'shared'))).toEqual(['договор с УК', 'ключи от дачи']);
  });

  it('«Личное» оставляет только личное', () => {
    expect(ids(filterByScope(ITEMS, 'personal'))).toEqual(['мой паспорт', 'заметка о подарке']);
  });

  it('каждая запись попадает ровно в «Общее» или «Личное»', () => {
    for (const item of ITEMS) {
      const inShared = matchesScope(item.visibility, 'shared');
      const inPersonal = matchesScope(item.visibility, 'personal');
      expect(inShared).not.toBe(inPersonal);
      expect(matchesScope(item.visibility, 'all')).toBe(true);
    }
  });

  it('не меняет исходный список', () => {
    const before = [...ITEMS];
    filterByScope(ITEMS, 'personal');
    expect(ITEMS).toEqual(before);
  });

  it('распознаёт только известные значения', () => {
    expect(isScope('shared')).toBe(true);
    expect(isScope('household')).toBe(false);
    expect(isScope(null)).toBe(false);
    expect(isScope(42)).toBe(false);
  });
});

describe('запоминание выбора на устройстве', () => {
  it('без сохранённого значения — «Всё»', () => {
    expect(loadScope(memoryStorage())).toBe('all');
  });

  it('сохранённый выбор возвращается после «перезагрузки»', () => {
    const storage = memoryStorage();
    saveScope(storage, 'personal');
    expect(storage.data.get(SCOPE_STORAGE_KEY)).toBe('personal');
    expect(loadScope(storage)).toBe('personal');
    saveScope(storage, 'shared');
    expect(loadScope(storage)).toBe('shared');
  });

  it('повреждённое значение заменяется на «Всё»', () => {
    for (const bad of ['', 'Личное', '{"scope":"shared"}', 'null']) {
      expect(loadScope(memoryStorage({ [SCOPE_STORAGE_KEY]: bad }))).toBe('all');
    }
  });

  it('без хранилища работает, но ничего не запоминает', () => {
    expect(loadScope(null)).toBe('all');
    expect(() => saveScope(null, 'shared')).not.toThrow();
    expect(() => clearScope(null)).not.toThrow();
  });

  it('если хранилище бросает ошибки, возвращает «Всё» и предупреждает в консоли', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('закрыто настройками');
      },
      setItem: () => {
        throw new Error('закрыто настройками');
      },
      removeItem: () => {
        throw new Error('закрыто настройками');
      },
    };
    expect(loadScope(broken)).toBe('all');
    expect(() => saveScope(broken, 'personal')).not.toThrow();
    expect(() => clearScope(broken)).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('сброс удаляет сохранённое значение', () => {
    const storage = memoryStorage({ [SCOPE_STORAGE_KEY]: 'personal' });
    clearScope(storage);
    expect(storage.data.has(SCOPE_STORAGE_KEY)).toBe(false);
    expect(loadScope(storage)).toBe('all');
  });
});
