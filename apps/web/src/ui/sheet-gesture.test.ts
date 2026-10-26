import { describe, expect, it } from 'vitest';
import { dismissSheet } from './sheet-gesture.ts';

describe('смахивание листа', () => {
  it('закрывается после 30 процентов либо скорости 0,6 px/мс', () => {
    expect(dismissSheet(151, 500, 1000)).toBe(true);
    expect(dismissSheet(150, 500, 1000)).toBe(false);
    expect(dismissSheet(61, 500, 100)).toBe(true);
    expect(dismissSheet(60, 500, 100)).toBe(false);
  });
  it('движение вверх и дрожание руки не закрывают лист', () => {
    expect(dismissSheet(-200, 500, 10)).toBe(false);
    expect(dismissSheet(10, 500, 1)).toBe(false);
  });
});
