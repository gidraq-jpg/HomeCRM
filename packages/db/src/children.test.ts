// Дочерние записи (PRD 7.3.3): пространство и аудитория те же, что у родителя; шире родителя запись
// не видна; переносят и убирают в корзину вместе с родителем. Образец — пункты чек-листа заметки.
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { noteItems, notes } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import type { Person } from './testing/family.ts';
import { addNote, createScene, rowsOf, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let database: TestDatabase;
let scene: Scene;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(database);
});

afterAll(async () => {
  await database?.drop();
});

const columnsOf = (placement: ReturnType<Scene['home']>) => ({
  spaceId: placement.spaceId,
  spaceKind: placement.kind,
  audience: placement.kind === 'household' ? placement.audience : null,
});

/** Пункт чек-листа от суперпользователя: триггеры работают, RLS — нет. */
async function addItem(
  parentId: string,
  placement: ReturnType<Scene['home']>,
  author: Person,
  trashedDaysAgo?: number,
): Promise<string> {
  const { rows } = await database.admin.query<{ id: string }>(
    `INSERT INTO note_items (parent_id, space_id, space_kind, audience, author_id, title, deleted_at)
     VALUES ($1, $2, $3, $4, $5, 'пункт',
       CASE WHEN $6::int IS NULL THEN NULL ELSE now() - make_interval(days => $6::int) END)
     RETURNING id`,
    [
      parentId,
      placement.spaceId,
      placement.kind,
      placement.kind === 'household' ? placement.audience : null,
      author.id,
      trashedDaysAgo ?? null,
    ],
  );
  return rows[0]?.id ?? '';
}

// 23503 — внешний ключ на родителя; 42501 — в чужой дом Анна не вправе писать вовсе.
const NOT_SAME_PLACE = ['23503', '42501'];

describe('пункт наследует место заметки', () => {
  it('в том же месте — можно; в другой аудитории, в другом пространстве или чужом доме — нельзя', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, { author: anna, placement: home });
    const insert = (place: ReturnType<Scene['home']>) =>
      scene.as('anna', (tx) =>
        tx
          .insert(noteItems)
          .values({ ...columnsOf(place), parentId, authorId: anna.id, title: 'п' }),
      );

    await insert(home);
    for (const place of [
      scene.home('adults'),
      scene.personal('anna'),
      scene.neighbours('household'),
    ]) {
      // Внешние ключи на родителя отложены до конца транзакции: ошибка приходит при фиксации.
      await expect(insert(place), JSON.stringify(place)).rejects.toSatisfy((error) =>
        hasCode(error, NOT_SAME_PLACE),
      );
    }
  });

  it('у личной заметки пункты личные: в общее пространство пункт не попадёт', async () => {
    const anna = scene.person('anna');
    const personal = scene.personal('anna');
    const parentId = await addNote(database.admin, { author: anna, placement: personal });
    await scene.as('anna', (tx) =>
      tx
        .insert(noteItems)
        .values({ ...columnsOf(personal), parentId, authorId: anna.id, title: 'п' }),
    );
    await expect(
      scene.as('anna', (tx) =>
        tx.insert(noteItems).values({
          ...columnsOf(scene.home('household')),
          parentId,
          authorId: anna.id,
          title: 'п',
        }),
      ),
    ).rejects.toSatisfy((error) => hasCode(error, NOT_SAME_PLACE));
  });

  it('пункты «Взрослых» ребёнок не видит, а личные пункты не видит никто, кроме владельца', async () => {
    const anna = scene.person('anna');
    const adultsNote = await addNote(database.admin, {
      author: anna,
      placement: scene.home('adults'),
    });
    const personalNote = await addNote(database.admin, {
      author: anna,
      placement: scene.personal('anna'),
    });
    await addItem(adultsNote, scene.home('adults'), anna);
    await addItem(personalNote, scene.personal('anna'), anna);
    const visible = async (who: 'anna' | 'boris' | 'vera') =>
      (
        await scene.as(who, (tx) =>
          tx
            .select({ id: noteItems.id })
            .from(noteItems)
            .where(inArray(noteItems.parentId, [adultsNote, personalNote])),
        )
      ).length;
    expect(await visible('anna')).toBe(2);
    expect(await visible('boris')).toBe(1);
    expect(await visible('vera')).toBe(0);
  });
});

describe('перенос вместе с родителем (PRD 7.3.5)', () => {
  it('изменение заметки переносит пункты каскадом; пункты без родителя менять место не могут', async () => {
    const anna = scene.person('anna');
    const parentId = await addNote(database.admin, {
      author: anna,
      placement: scene.home('household'),
    });
    await addItem(parentId, scene.home('household'), anna);
    await addItem(parentId, scene.home('household'), scene.person('boris'));

    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, parentId)),
    );
    expect(
      await rowsOf(database.admin, 'SELECT audience FROM note_items WHERE parent_id=$1', [
        parentId,
      ]),
    ).toEqual([{ audience: 'adults' }, { audience: 'adults' }]);
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'household' }).where(eq(notes.id, parentId)),
    );
    await expect(
      scene.as('boris', (tx) =>
        tx.update(noteItems).set({ audience: 'adults' }).where(eq(noteItems.parentId, parentId)),
      ),
      'дети без родителя',
    ).rejects.toSatisfy((error) => hasCode(error, NOT_SAME_PLACE));

    await scene.as('boris', async (tx) => {
      await tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, parentId));
      await tx
        .update(noteItems)
        .set({ audience: 'adults' })
        .where(eq(noteItems.parentId, parentId));
    });
    const audiences = await rowsOf<{ audience: string }>(
      database.admin,
      `SELECT audience FROM note_items WHERE parent_id = $1`,
      [parentId],
    );
    expect(audiences).toEqual([{ audience: 'adults' }, { audience: 'adults' }]);
  });

  it('пункт в корзине переезжает с родителем, хотя сам в корзине менять нельзя', async () => {
    const anna = scene.person('anna');
    const parentId = await addNote(database.admin, {
      author: anna,
      placement: scene.home('household'),
    });
    const itemId = await addItem(parentId, scene.home('household'), anna, 1);
    await scene.as('anna', async (tx) => {
      await tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, parentId));
      await tx.update(noteItems).set({ audience: 'adults' }).where(eq(noteItems.id, itemId));
    });
    // Но править его в корзине по-прежнему нельзя.
    await expect(
      scene.as('anna', (tx) =>
        tx.update(noteItems).set({ title: 'правка' }).where(eq(noteItems.id, itemId)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('личную заметку делают общей вместе с пунктами', async () => {
    const boris = scene.person('boris');
    const parentId = await addNote(database.admin, {
      author: boris,
      placement: scene.personal('boris'),
    });
    await addItem(parentId, scene.personal('boris'), boris);
    const shared = columnsOf(scene.home('household'));
    await scene.as('boris', async (tx) => {
      await tx.update(notes).set(shared).where(eq(notes.id, parentId));
      await tx.update(noteItems).set(shared).where(eq(noteItems.parentId, parentId));
    });
    const seen = await scene.as('vera', (tx) =>
      tx.select({ id: noteItems.id }).from(noteItems).where(eq(noteItems.parentId, parentId)),
    );
    expect(seen).toHaveLength(1);
  });
});

describe('корзина родителя (DATA-1)', () => {
  it('заметка в корзину — и пункты за ней; восстановили — вернулись те, что ушли вместе с ней', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, { author: anna, placement: home });
    const kept = await addItem(parentId, home, anna);
    const earlier = await addItem(parentId, home, anna, 5);
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, parentId)),
    );
    const trashed = async () =>
      rowsOf<{ id: string; trashed: boolean }>(
        database.admin,
        `SELECT id, deleted_at IS NOT NULL AS trashed FROM note_items WHERE parent_id = $1 ORDER BY id`,
        [parentId],
      );
    expect((await trashed()).every((row) => row.trashed)).toBe(true);

    await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, parentId)),
    );
    const after = new Map((await trashed()).map((row) => [row.id, row.trashed]));
    expect(after.get(kept)).toBe(false);
    // Пункт, убранный раньше, сам по себе остаётся в корзине.
    expect(after.get(earlier)).toBe(true);
  });

  it('взрослый восстанавливает свою заметку, а пункт чужого автора остаётся в корзине — его вернёт администратор', async () => {
    const boris = scene.person('boris');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, { author: boris, placement: home });
    const own = await addItem(parentId, home, boris);
    const foreign = await addItem(parentId, home, scene.person('anna'));
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, parentId)),
    );
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, parentId)),
    );
    const state = async () =>
      new Map(
        (
          await rowsOf<{ id: string; trashed: boolean }>(
            database.admin,
            `SELECT id, deleted_at IS NOT NULL AS trashed FROM note_items WHERE parent_id = $1`,
            [parentId],
          )
        ).map((row) => [row.id, row.trashed]),
      );
    expect((await state()).get(own)).toBe(false);
    expect((await state()).get(foreign)).toBe(true);

    await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, foreign)),
    );
    expect((await state()).get(foreign)).toBe(false);
  });

  it('очистка корзины убирает просроченную заметку вместе с её пунктами в корзине и историей', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, {
      author: anna,
      placement: home,
      trashedDaysAgo: 31,
    });
    // Пункты, убранные вместе с заметкой: живого пункта под заметкой в корзине быть не может.
    const itemId = await addItem(parentId, home, anna, 31);
    expect(
      await rowsOf(database.admin, `SELECT 1 FROM note_items_history WHERE record_id = $1`, [
        itemId,
      ]),
    ).toHaveLength(1);
    const purged = await database.worker.query('DELETE FROM notes WHERE id = $1', [parentId]);
    expect(purged.rowCount).toBe(1);
    expect(
      await rowsOf(database.admin, `SELECT 1 FROM note_items WHERE id = $1`, [itemId]),
    ).toEqual([]);
    expect(
      await rowsOf(database.admin, `SELECT 1 FROM note_items_history WHERE record_id = $1`, [
        itemId,
      ]),
    ).toEqual([]);
  });
});

describe('живой пункт при заметке в корзине невозможен (очистка корзины не должна уносить живое)', () => {
  const liveUnderTrashed = () =>
    rowsOf(
      database.admin,
      `SELECT i.id FROM note_items i JOIN notes n ON n.id = i.parent_id
       WHERE i.deleted_at IS NULL AND n.deleted_at IS NOT NULL`,
    );

  it('вставка пункта под заметку в корзине — отказ; под живую — можно', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const trashedParent = await addNote(database.admin, {
      author: anna,
      placement: home,
      trashedDaysAgo: 1,
    });
    const insert = (parentId: string) =>
      scene.as('anna', (tx) =>
        tx
          .insert(noteItems)
          .values({ ...columnsOf(home), parentId, authorId: anna.id, title: 'п' }),
      );
    await expect(insert(trashedParent)).rejects.toMatchObject({ cause: { code: '42501' } });
    // Суперпользователь упирается в тот же триггер: он не обходит правило.
    await expect(addItem(trashedParent, home, anna)).rejects.toMatchObject({ code: '42501' });
    await insert(await addNote(database.admin, { author: anna, placement: home }));
    expect(await liveUnderTrashed()).toEqual([]);
  });

  it('пункт, убранный отдельно, не восстановить, пока заметка в корзине; после неё — можно', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, { author: anna, placement: home });
    const itemId = await addItem(parentId, home, anna, 5);
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, parentId)),
    );
    await expect(
      scene.as('anna', (tx) =>
        tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, itemId)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect(await liveUnderTrashed()).toEqual([]);

    await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, parentId)),
    );
    const restored = await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, itemId)),
    );
    expect(restored.rowCount).toBe(1);
  });

  it('живой пункт нельзя перенести под заметку в корзине', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const liveParent = await addNote(database.admin, { author: anna, placement: home });
    const trashedParent = await addNote(database.admin, {
      author: anna,
      placement: home,
      trashedDaysAgo: 2,
    });
    const itemId = await addItem(liveParent, home, anna);
    await expect(
      scene.as('anna', (tx) =>
        tx.update(noteItems).set({ parentId: trashedParent }).where(eq(noteItems.id, itemId)),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    expect(await liveUnderTrashed()).toEqual([]);
  });

  it('просроченная заметка уходит при очистке, а живого пункта у неё нет — удалять мимо корзины нечего', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const parentId = await addNote(database.admin, { author: anna, placement: home });
    const itemId = await addItem(parentId, home, anna);
    // Заметку убирают в корзину вместе с живым пунктом; состояние «живой пункт при заметке в корзине»
    // после этого невозможно, поэтому очистка удаляет только то, что и так лежало в корзине.
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, parentId)),
    );
    expect(await liveUnderTrashed()).toEqual([]);
    const [item] = await rowsOf<{ trashed: boolean }>(
      database.admin,
      `SELECT deleted_at IS NOT NULL AS trashed FROM note_items WHERE id = $1`,
      [itemId],
    );
    expect(item?.trashed).toBe(true);
  });
});
