import { expect, it } from 'vitest';
import { durationMilliseconds } from './motion.ts';

it.each([
  ['160ms', 160],
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
