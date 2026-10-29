import { describe, expect, it } from 'vitest';
import { rowSwipeArmed, rowSwipeDirection, rowSwipeResult, swipeDirection } from './swipe.ts';

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
describe('жест строки дела', () => {
  const start = { x: 180, y: 300, time: 0 };
  it('захватывает горизонтальное направление, оставляет вертикаль и края системе', () => {
    expect(rowSwipeDirection(start, { x: 200, y: 305, time: 50 }, 360)).toBe(1);
    expect(rowSwipeDirection(start, { x: 160, y: 305, time: 50 }, 360)).toBe(-1);
    expect(rowSwipeDirection(start, { x: 200, y: 320, time: 50 }, 360)).toBe(0);
    expect(rowSwipeDirection(start, { x: 190, y: 300, time: 50 }, 360)).toBe(0);
    for (const x of [23, 338])
      expect(rowSwipeDirection({ ...start, x }, { x: 180, y: 300, time: 50 }, 360)).toBe(0);
  });
  it('короткий открывает 104 px, действие — только протяжка дальше 68 % строки', () => {
    expect(rowSwipeResult(56, 300, 1000)).toBe('close');
    expect(rowSwipeResult(57, 300, 1000)).toBe('reveal');
    expect(rowSwipeResult(-57, 300, 1000)).toBe('reveal');
    expect(rowSwipeResult(150, 300, 1000)).toBe('reveal');
    expect(rowSwipeResult(204, 300, 1000)).toBe('reveal');
    expect(rowSwipeResult(205, 300, 1000)).toBe('action');
    expect(rowSwipeResult(-205, 300, 1000)).toBe('action');
    expect(rowSwipeArmed(204, 300)).toBe(false);
    expect(rowSwipeArmed(-205, 300)).toBe(true);
    expect(rowSwipeArmed(10, 0)).toBe(false);
  });
  it('случайный быстрый рывок только открывает кнопку, но не выполняет действие', () => {
    expect(rowSwipeResult(61, 300, 100)).toBe('reveal');
    expect(rowSwipeResult(180, 300, 60)).toBe('reveal');
    expect(rowSwipeResult(-180, 328, 40)).toBe('reveal');
    expect(rowSwipeResult(40, 300, 30)).toBe('reveal');
    expect(rowSwipeResult(40, 300, 300)).toBe('close');
    expect(rowSwipeResult(20, 300, 5)).toBe('close');
  });
  it('не принимает уже открытую часть строки за скорость нового жеста', () => {
    expect(rowSwipeResult(-84, 328, 20, 20)).toBe('reveal');
    expect(rowSwipeResult(84, 328, 20, -20)).toBe('reveal');
    expect(rowSwipeResult(-170, 328, 500, -66)).toBe('reveal');
    expect(rowSwipeResult(-230, 328, 500, -126)).toBe('action');
  });
  it('резкий встречный жест закрывает открытую кнопку, а не выполняет её действие', () => {
    expect(rowSwipeResult(-34, 328, 50, 70)).toBe('close');
    expect(rowSwipeResult(34, 328, 50, -70)).toBe('close');
  });
});
