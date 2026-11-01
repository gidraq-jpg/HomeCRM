import type { Visibility } from '../access/visibility.ts';
import { newPlacement } from '../notes/abilities.ts';
import { uuid } from '../offline/store.ts';
import type { ShoppingDraft } from '../voice/shopping-dictation.ts';
import { createShopping, type ShoppingCard, shoppingAction } from './api.ts';
import { listedNames, shoppingName } from './duplicates.ts';

/** Состояние пачки живёт до известного исхода каждого запроса, включая повтор после сбоя. */
export function shoppingBatch(drafts: ShoppingDraft[], place: Visibility, house: string | null) {
  const placement = newPlacement(place, house);
  const rows = drafts.map((draft) => ({
    body: { ...draft, ...(placement ? { placement } : {}), idempotencyKey: uuid() },
    card: null as ShoppingCard | null,
    skipped: false,
    attempted: false,
    undoKey: uuid(),
    undone: false,
  }));
  let busy = false;
  return {
    async add() {
      const listed = await listedNames(place, house);
      const seen = new Set<string>();
      for (const row of rows) {
        const name = shoppingName(row.body.title);
        if (row.card || row.skipped) {
          seen.add(name);
          continue;
        }
        // Неизвестный исход POST сначала повторяем с прежним ключом, даже если GET уже видит запись.
        if (!row.attempted && (listed.has(name) || seen.has(name))) row.skipped = true;
        else {
          row.attempted = true;
          row.card = await createShopping(row.body);
        }
        seen.add(name);
      }
      return {
        added: rows.filter((row) => row.card).length,
        duplicates: rows.filter((row) => row.skipped).length,
      };
    },
    async undo() {
      if (busy) return;
      busy = true;
      try {
        for (const row of rows)
          if (row.card && !row.undone) {
            await shoppingAction(row.card, 'trash', row.undoKey);
            row.undone = true;
          }
      } finally {
        busy = false;
      }
    },
  };
}
