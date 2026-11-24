import { describe, expect, it } from 'vitest';
import type { ShoppingCard } from './api.ts';
import {
  initialHouse,
  openCount,
  rowMeta,
  selectedListOf,
  shownQuantity,
  splitShopping,
} from './shopping-list.ts';

const card = (
  patch: Omit<Partial<ShoppingCard>, 'data'> & { data?: Partial<ShoppingCard['data']> } = {},
) =>
  ({
    id: patch.id ?? 'c1',
    title: 'Молоко',
    quantity: null,
    boughtAt: null,
    spaceKind: 'household',
    audience: 'household',
    ...patch,
    data: { note: '', store: '', category: '', ...patch.data },
  }) as ShoppingCard;

describe('список покупок', () => {
  it('считает некупленное только в выбранном списке', () => {
    const cards = [
      card({ id: 'a' }),
      card({ id: 'b', boughtAt: '2026-10-05T10:00:00Z' }),
      card({ id: 'c', spaceKind: 'personal' }),
    ];
    expect(openCount(cards, 'household')).toBe(1);
    expect(openCount(cards, 'personal')).toBe(1);
  });

  it('подписывает строку: заметка, магазин, «Взрослые» и «Куплено»', () => {
    expect(rowMeta(card())).toBe('');
    expect(
      rowMeta(
        card({
          audience: 'adults',
          boughtAt: '2026-10-05T10:00:00Z',
          data: { note: '2 пачки', store: 'Рынок' },
        }),
      ),
    ).toBe('2 пачки · Рынок · Взрослые · Куплено');
    expect(rowMeta(card({ spaceKind: 'personal', audience: 'adults' }))).toBe('');
  });

  it('показывает «×1» только у позиции, которую можно менять', () => {
    expect(shownQuantity(card(), true)).toBe('1');
    expect(shownQuantity(card(), false)).toBeNull();
    expect(shownQuantity(card({ quantity: '3' }), false)).toBe('3');
  });

  it('группирует некупленное по категории, затем по магазину', () => {
    const { groups, bought } = splitShopping([
      card({ id: 'a', data: { category: 'Молочное' } }),
      card({ id: 'b', data: { store: 'Рынок' } }),
      card({ id: 'c' }),
      card({ id: 'd', data: { category: 'Молочное' } }),
      card({ id: 'e', boughtAt: '2026-10-05T10:00:00Z' }),
    ]);
    expect(groups.map(([name, items]) => [name, items.map((c) => c.id)])).toEqual([
      ['Молочное', ['a', 'd']],
      ['Рынок', ['b']],
      ['Без магазина', ['c']],
    ]);
    expect(bought.map((c) => c.id)).toEqual(['e']);
  });

  it('берёт дом из адреса, только если вы в нём состоите', () => {
    const roles = [{ householdId: 'h1' }, { householdId: 'h2' }];
    expect(initialHouse(roles, 'h2', 'h1')).toBe('h2');
    expect(initialHouse(roles, 'чужой', 'h1')).toBe('h1');
    expect(initialHouse(roles, null, null)).toBe('');
  });

  it('выбирает показанный список по дому и режиму', () => {
    expect(selectedListOf('', 'all', 'household')).toBe('personal');
    expect(selectedListOf('h1', 'personal', 'household')).toBe('personal');
    expect(selectedListOf('h1', 'all', 'personal')).toBe('personal');
    expect(selectedListOf('h1', 'shared', 'personal')).toBe('household');
  });
});
