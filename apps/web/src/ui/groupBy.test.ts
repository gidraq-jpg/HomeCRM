import { expect, it } from 'vitest';
import { groupBy } from './groupBy.ts';

it('UI-5/D19a.6: группы покупок работают без Map.groupBy и сохраняют порядок', () => {
  const a = { category: 'Дом', title: 'Мыло' },
    b = { category: 'Еда', title: 'Хлеб' },
    c = { category: 'Дом', title: 'Щётка' };
  expect([...groupBy([a, b, c], (item) => item.category)]).toEqual([
    ['Дом', [a, c]],
    ['Еда', [b]],
  ]);
  expect([...groupBy([], () => '')]).toEqual([]);
});
