import { describe, expect, it, vi } from 'vitest';
import { parseTheme, readTheme, THEME_STORAGE_KEY, THEMES } from './theme.ts';

describe('темы', () => {
  it('неизвестное и пустое значение — Studio', () => {
    expect(parseTheme(null)).toBe('studio');
    expect(parseTheme('dark')).toBe('studio');
    for (const theme of THEMES) expect(parseTheme(theme)).toBe(theme);
  });

  it('читает сохранённую тему', () => {
    const storage = { getItem: vi.fn(() => 'mono'), setItem: vi.fn() };
    expect(readTheme(storage)).toBe('mono');
    expect(storage.getItem).toHaveBeenCalledWith(THEME_STORAGE_KEY);
  });

  it('ошибка хранилища даёт Studio и попадает в консоль', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: vi.fn(),
    };
    expect(readTheme(storage)).toBe('studio');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
