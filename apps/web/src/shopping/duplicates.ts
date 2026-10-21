import type { Visibility } from '../access/visibility.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { fetchShopping } from './api.ts';

export const shoppingName = (title: string) => title.toLocaleLowerCase('ru').replace(/\s+/gu, '');

/**
 * Названия некупленных позиций выбранного списка, включая ещё не загруженные страницы.
 * Черновики голосом загружают их один раз на нажатие «Добавить», а не на каждую позицию.
 */
export async function listedNames(visibility: Visibility, house: string | null) {
  const names = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    const page = await fetchShopping(
      visibility === 'personal' ? 'personal' : 'household',
      house,
      false,
      offset,
    );
    for (const item of page)
      if (!item.boughtAt && visibilityOf(item) === visibility) names.add(shoppingName(item.title));
    if (page.length < 100) return names;
  }
}

/** Проверяем и ещё не загруженные страницы выбранного списка; купленное не мешает новой покупке. */
export async function alreadyListed(title: string, visibility: Visibility, house: string | null) {
  return (await listedNames(visibility, house)).has(shoppingName(title));
}
