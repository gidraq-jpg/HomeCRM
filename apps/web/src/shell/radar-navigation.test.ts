import { expect, it } from 'vitest';
import { radarFromToday } from './BottomNav.tsx';

it('UI-5/D19a.10: источник перехода определяется state, режим mine не меняет dock', () => {
  expect(radarFromToday('?view=mine', null)).toBe(false);
  expect(radarFromToday('?view=house', { fromSection: 'today' })).toBe(true);
  expect(radarFromToday('', { fromSection: 'more' })).toBe(false);
});
