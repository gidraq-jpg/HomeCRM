import { describe, expect, it } from 'vitest';
import { swipeDirection } from './swipe.ts';

describe('D20a-1: горизонтальный жест', () => {
  const start = { x: 180, y: 300, time: 0 };
  it('длинный жест и быстрый короткий идут в обе стороны', () => {
    expect(swipeDirection(start, { x: 80, y: 310, time: 900 }, 360)).toBe(1);
    expect(swipeDirection(start, { x: 280, y: 290, time: 900 }, 360)).toBe(-1);
    expect(swipeDirection(start, { x: 120, y: 300, time: 90 }, 412)).toBe(1);
  });
  it('игнорирует вертикаль, диагональ, короткий медленный жест и касание', () => {
    for (const end of [
      { x: 80, y: 450, time: 100 },
      { x: 80, y: 370, time: 100 },
      { x: 130, y: 300, time: 900 },
      { x: 170, y: 300, time: 5 },
      start,
    ])
      expect(swipeDirection(start, end, 360)).toBe(0);
  });
  it('оставляет 24 px у обоих краёв для системы', () => {
    expect(swipeDirection({ ...start, x: 23 }, { x: 200, y: 300, time: 100 }, 360)).toBe(0);
    expect(swipeDirection({ ...start, x: 337 }, { x: 100, y: 300, time: 100 }, 360)).toBe(0);
    expect(swipeDirection({ ...start, x: 24 }, { x: 200, y: 300, time: 100 }, 360)).toBe(-1);
  });
});
