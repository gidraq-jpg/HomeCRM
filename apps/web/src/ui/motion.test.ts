import { expect, it } from 'vitest';
import { durationMilliseconds, motionStagger } from './motion.ts';

it.each([
  ['160ms', 160],
  ['calc(450ms * 4)', 1800],
  ['calc(0.38s * 4)', 1520],
  ['240ms', 240],
  ['400ms', 400],
  ['560ms', 560],
  ['.16s', 160],
  ['0.24s', 240],
  ['.4s', 400],
  [' .56s ', 560],
  ['', 0],
  ['auto', 0],
])('CSS-время %s, включая сокращение сборщика, даёт %d мс', (value, expected) => {
  expect(durationMilliseconds(value)).toBe(expected);
});

it('ограничивает очередь длинного списка тремя шагами', () => {
  expect([0, 1, 2, 3, 100].map((index) => motionStagger(index, 240))).toEqual([
    0, 48, 96, 144, 144,
  ]);
  expect(motionStagger(3, 960)).toBe(576);
  expect(motionStagger(-1, 240)).toBe(0);
});
