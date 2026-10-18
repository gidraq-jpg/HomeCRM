import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useKeyboardAttribute } from './useKeyboardAttribute.ts';

vi.mock('react', () => ({ useEffect: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

for (const hasOrientation of [true, false]) {
  it(`поворот до resize обновляет базовую высоту: ${hasOrientation ? 'screen.orientation' : 'matchMedia'}`, () => {
    const viewport = Object.assign(new EventTarget(), { height: 740 });
    const orientation = new EventTarget();
    const fallback = new EventTarget();
    const root = { dataset: {} as Record<string, string> };
    const matchMedia = vi.fn((query: string) =>
      query === '(pointer: coarse)' ? { matches: true } : fallback,
    );
    vi.stubGlobal('window', {
      visualViewport: viewport,
      screen: { orientation: hasOrientation ? orientation : undefined },
      matchMedia,
    });
    vi.stubGlobal('document', { documentElement: root });
    useKeyboardAttribute();
    const cleanup = vi.mocked(useEffect).mock.calls[0]?.[0]();
    const resize = (height: number) => {
      viewport.height = height;
      viewport.dispatchEvent(new Event('resize'));
    };
    resize(450);
    expect(root.dataset.keyboard).toBe('open');
    resize(740);
    expect(root.dataset.keyboard).toBeUndefined();
    // Событие ориентации приходит, когда viewport ещё портретный.
    (hasOrientation ? orientation : fallback).dispatchEvent(new Event('change'));
    resize(360);
    expect(root.dataset.keyboard).toBeUndefined();
    resize(200);
    expect(root.dataset.keyboard).toBe('open');
    (hasOrientation ? orientation : fallback).dispatchEvent(new Event('change'));
    resize(740);
    expect(root.dataset.keyboard).toBeUndefined();
    if (typeof cleanup === 'function') cleanup();
    resize(200);
    expect(root.dataset.keyboard).toBeUndefined();
    expect(matchMedia).toHaveBeenCalledTimes(hasOrientation ? 1 : 2);
  });
}
