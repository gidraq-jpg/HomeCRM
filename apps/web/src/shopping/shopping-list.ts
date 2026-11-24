import { groupBy } from '../ui/groupBy.ts';
import type { ShoppingCard } from './api.ts';

type ListKind = 'household' | 'personal';

/** Сколько некупленного в выбранном списке: личном или общем. */
export function openCount(cards: readonly ShoppingCard[], list: ListKind): number {
  return cards.filter((card) => !card.boughtAt && card.spaceKind === list).length;
}

/** Подпись строки: заметка, магазин, «Взрослые» как исключение доступа и «Куплено». */
export function rowMeta(card: ShoppingCard): string {
  return [
    card.data.note,
    card.data.store,
    card.spaceKind !== 'personal' && card.audience === 'adults' ? 'Взрослые' : null,
    card.boughtAt ? 'Куплено' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Количество показано всегда одним видом «×N»; у позиции без количества, которую можно менять, — «×1». */
export function shownQuantity(card: ShoppingCard, adjustable: boolean): string | null {
  return card.quantity ?? (adjustable ? '1' : null);
}

/** Некупленное по категориям (или магазину) и купленное отдельно. */
export function splitShopping(items: readonly ShoppingCard[]) {
  const open = items.filter((card) => !card.boughtAt);
  const bought = items.filter((card) => !!card.boughtAt);
  return {
    groups: [...groupBy(open, (card) => card.data.category || card.data.store || 'Без магазина')],
    bought,
  };
}

/** Дом списка при открытии: из адреса, если вы в нём состоите, иначе текущий. */
export function initialHouse(
  roles: readonly { householdId: string }[],
  requested: string | null,
  current: string | null,
): string {
  return roles.some((role) => role.householdId === requested) ? (requested ?? '') : (current ?? '');
}

/** Какой список показан: без дома или в личном режиме — личный, в общем режиме — общий. */
export function selectedListOf(house: string, scope: string, choice: ListKind): ListKind {
  return !house || scope === 'personal' ? 'personal' : scope === 'all' ? choice : 'household';
}
