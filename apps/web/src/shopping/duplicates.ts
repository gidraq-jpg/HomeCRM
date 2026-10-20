import type { Visibility } from '../access/visibility.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { fetchShopping } from './api.ts';

export const shoppingName = (title: string) => title.toLocaleLowerCase('ru').replace(/\s+/gu, '');

/** Проверяем и ещё не загруженные страницы выбранного списка; купленное не мешает новой покупке. */
export async function alreadyListed(title: string, visibility: Visibility, house: string | null) {
  const name = shoppingName(title);
  for (let offset = 0; ; offset += 100) {
    const page = await fetchShopping(
      visibility === 'personal' ? 'personal' : 'household',
      house,
      false,
      offset,
    );
    if (
      page.some(
        (item) =>
          !item.boughtAt && visibilityOf(item) === visibility && shoppingName(item.title) === name,
      )
    )
      return true;
    if (page.length < 100) return false;
  }
}
