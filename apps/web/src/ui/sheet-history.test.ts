import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSheetBack, prepareSheetNavigation, registerSheet } from './sheet-history.ts';

afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const history = {
    state: { key: 'page', idx: 2 } as Record<string, unknown>,
    pushState: vi.fn((state: Record<string, unknown>) => {
      history.state = state;
    }),
    back: vi.fn(),
  };
  vi.stubGlobal('history', history);
  vi.stubGlobal('location', { href: 'http://local/#/note' });
  return history;
}
describe('история листов', () => {
  it('повтор effect не добавляет второй шаг и не закрывает лист', async () => {
    const history = fixture();
    const owner = {};
    const close = vi.fn();
    registerSheet(close, owner)();
    const cleanup = registerSheet(close, owner);
    await Promise.resolve();
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.back).not.toHaveBeenCalled();
    const event = {
      state: { key: 'page', idx: 2 },
      stopImmediatePropagation: vi.fn(),
    } as unknown as PopStateEvent;
    expect(consumeSheetBack(event)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    history.state = event.state;
    cleanup();
    await Promise.resolve();
  });
  it('переход из подтверждения поглощает его шаг без позднего Назад', async () => {
    const history = fixture();
    const cleanup = registerSheet(vi.fn(), {});
    expect(prepareSheetNavigation()).toBe(true);
    cleanup();
    await Promise.resolve();
    expect(history.back).not.toHaveBeenCalled();
  });
  it('системное Назад закрывает только верхний лист', async () => {
    const history = fixture();
    const lower = vi.fn();
    const upper = vi.fn();
    const cleanLower = registerSheet(lower, {});
    const first = { ...history.state };
    const cleanUpper = registerSheet(upper, {});
    const event = { state: first, stopImmediatePropagation: vi.fn() } as unknown as PopStateEvent;
    expect(consumeSheetBack(event)).toBe(true);
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
    history.state = first;
    cleanUpper();
    cleanLower();
    await Promise.resolve();
  });
  it('новый адрес во время закрытия не принимается за Назад листа', async () => {
    const history = fixture();
    const close = vi.fn();
    const cleanup = registerSheet(close, {});
    const next = { key: 'next-page', idx: 3 };
    history.state = next;
    vi.stubGlobal('location', { href: 'http://local/#/task' });
    const event = { state: next, stopImmediatePropagation: vi.fn() } as unknown as PopStateEvent;
    try {
      expect(consumeSheetBack(event)).toBe(false);
      expect(close).not.toHaveBeenCalled();
      expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    } finally {
      cleanup();
      await Promise.resolve();
    }
    expect(history.back).not.toHaveBeenCalled();
  });
  it('новая навигация отменяет ожидание popstate закрытого листа', async () => {
    const history = fixture();
    const cleanup = registerSheet(vi.fn(), {});
    cleanup();
    await Promise.resolve();
    expect(history.back).toHaveBeenCalledOnce();
    vi.stubGlobal('location', { href: 'http://local/#/task' });
    const next = {
      state: { key: 'next-page', idx: 3 },
      stopImmediatePropagation: vi.fn(),
    } as unknown as PopStateEvent;
    expect(consumeSheetBack(next)).toBe(false);
    vi.stubGlobal('location', { href: 'http://local/#/note' });
    const back = {
      state: { key: 'page', idx: 2 },
      stopImmediatePropagation: vi.fn(),
    } as unknown as PopStateEvent;
    expect(consumeSheetBack(back)).toBe(false);
    expect(back.stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
