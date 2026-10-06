import { canCopyToPersonal, canMove, type RecordFacts } from '@homecrm/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { canViewSql, recordPolicySql } from './access-sql.ts';
import { noteItems, notes, notesHistory } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, type Scene } from './testing/helpers.ts';
import { isDenied } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
afterAll(async () => {
  await db?.drop();
});
const make = (common = true) =>
  addNote(db.admin, {
    author: scene.person('boris'),
    placement: common ? scene.home('household') : scene.personal('boris'),
  });
const privatize = (id: string) =>
  scene.as('boris', (tx) =>
    tx
      .update(notes)
      .set({ spaceId: scene.personal('boris').spaceId, spaceKind: 'personal', audience: null })
      .where(eq(notes.id, id)),
  );
describe('перенос: прямой SQL под RLS совпадает с canMove', () => {
  it('закрепление, аудитория, корзина и восстановление другим участником не считаются вкладом', async () => {
    const id = await make();
    for (const fields of [
      { pinned: true },
      { audience: 'adults' as const },
      { deletedAt: new Date() },
      { deletedAt: null },
    ])
      await scene.as('anna', (tx) => tx.update(notes).set(fields).where(eq(notes.id, id)));
    expect(
      (await db.admin.query('SELECT has_other_contributions FROM notes WHERE id=$1', [id])).rows[0]
        ?.has_other_contributions,
    ).toBe(false);
    await expect(privatize(id)).resolves.toMatchObject({ rowCount: 1 });
  });
  it('корзина и восстановление своего пункта другим участником не являются вкладом; отметка выполнения — является', async () => {
    const id = await make();
    const [item] = await scene.as('boris', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
          authorId: scene.person('boris').id,
          title: 'пункт автора',
        })
        .returning(),
    );
    if (!item) throw new Error('No item');
    await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ deletedAt: new Date() }).where(eq(noteItems.id, item.id)),
    );
    await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, item.id)),
    );
    expect(
      (await db.admin.query('SELECT has_other_contributions FROM notes WHERE id=$1', [id])).rows[0]
        ?.has_other_contributions,
    ).toBe(false);
    await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ done: true }).where(eq(noteItems.id, item.id)),
    );
    expect(
      (await db.admin.query('SELECT has_other_contributions FROM notes WHERE id=$1', [id])).rows[0]
        ?.has_other_contributions,
    ).toBe(true);
    await expect(privatize(id)).rejects.toSatisfy(isDenied);
  });
  it('удаление триггерной ветки RLS обнаруживает неперенесённый чужой пункт в корзине', async () => {
    const id = await make();
    const [item] = await scene.as('anna', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
          authorId: scene.person('anna').id,
          title: 'чужой пункт в корзине',
        })
        .returning(),
    );
    if (!item) throw new Error('No item');
    await scene.as('anna', (tx) =>
      tx.update(noteItems).set({ deletedAt: new Date() }).where(eq(noteItems.id, item.id)),
    );
    const policy = recordPolicySql('note_item');
    try {
      const restricted = recordPolicySql('note').updateUsing;
      await db.admin.query(`ALTER POLICY note_items_update ON note_items USING (${restricted})`);
      await expect(
        scene.as('boris', (tx) =>
          tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, id)),
        ),
      ).rejects.toSatisfy((error) => {
        // Отложенный FK обнаруживает, что ребёнок каскада не получил новое место.
        let current: unknown = error;
        for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
          if ('code' in current && current.code === '23503') return true;
          current = 'cause' in current ? current.cause : undefined;
        }
        return false;
      });
    } finally {
      await db.admin.query(
        `ALTER POLICY note_items_update ON note_items USING (${policy.updateUsing})`,
      );
    }
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, id)),
    );
    expect(
      (await db.admin.query('SELECT audience, deleted_at FROM note_items WHERE id=$1', [item.id]))
        .rows[0],
    ).toMatchObject({ audience: 'adults', deleted_at: expect.any(Date) });
  });
  for (const other of [false, true])
    for (const key of ['anna', 'boris', 'vera', 'dina', 'mila', 'gleb'] as const) {
      it(`${key}: сделать личной, чужой вклад ${other}`, async () => {
        const id = await make();
        if (other)
          await scene.as('anna', (tx) =>
            tx.update(notes).set({ title: 'вклад Анны' }).where(eq(notes.id, id)),
          );
        const viewer = scene.person(key);
        const facts: RecordFacts = {
          type: 'note',
          authorId: scene.person('boris').id,
          placement: scene.home('household'),
        };
        const allowed = canMove(viewer.viewer, facts, scene.personal(key), other);
        let actual = false;
        try {
          actual =
            (
              await scene.as(key, (tx) =>
                tx
                  .update(notes)
                  .set({ spaceId: viewer.personalSpaceId, spaceKind: 'personal', audience: null })
                  .where(eq(notes.id, id)),
              )
            ).rowCount === 1;
        } catch (error) {
          if (!isDenied(error)) throw error;
        }
        expect(actual).toBe(allowed);
      });
    }
  it('чужой вклад нельзя стереть подменой служебного признака', async () => {
    const id = await make();
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ body: 'чужая правка' }).where(eq(notes.id, id)),
    );
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ hasOtherContributions: false }).where(eq(notes.id, id)),
    );
    await expect(privatize(id)).rejects.toSatisfy(isDenied);
  });
  it('чужой пункт и его история запрещают перенос даже после корзины', async () => {
    const id = await make();
    const [item] = await scene.as('anna', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
          authorId: scene.person('anna').id,
          title: 'чужой пункт',
        })
        .returning(),
    );
    await scene.as('anna', (tx) =>
      tx
        .update(noteItems)
        .set({ deletedAt: new Date() })
        .where(eq(noteItems.id, item?.id ?? '')),
    );
    await expect(privatize(id)).rejects.toSatisfy(isDenied);
  });
  it('поделиться переносит также пункт в корзине и сохраняет его дату', async () => {
    const id = await make(false);
    const [item] = await scene.as('boris', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.personal('boris').spaceId,
          spaceKind: 'personal',
          authorId: scene.person('boris').id,
          title: 'пункт',
        })
        .returning(),
    );
    await scene.as('boris', (tx) =>
      tx
        .update(noteItems)
        .set({ deletedAt: new Date() })
        .where(eq(noteItems.id, item?.id ?? '')),
    );
    const before = (
      await db.admin.query('SELECT deleted_at FROM note_items WHERE id=$1', [item?.id])
    ).rows[0];
    await scene.as('boris', (tx) =>
      tx
        .update(notes)
        .set({
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
        })
        .where(eq(notes.id, id)),
    );
    const after = (
      await db.admin.query('SELECT space_id, deleted_at FROM note_items WHERE id=$1', [item?.id])
    ).rows[0];
    expect(after.space_id).toBe(scene.home('household').spaceId);
    expect(after.deleted_at).toEqual(before.deleted_at);
  });
  it('сужение переносит и чужие пункты в корзине, не давая править их содержимое', async () => {
    const id = await make();
    const [item] = await scene.as('anna', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
          authorId: scene.person('anna').id,
          title: 'пункт',
        })
        .returning(),
    );
    await scene.as('anna', (tx) =>
      tx
        .update(noteItems)
        .set({ deletedAt: new Date() })
        .where(eq(noteItems.id, item?.id ?? '')),
    );
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, id)),
    );
    expect(
      (await db.admin.query('SELECT audience FROM note_items WHERE id=$1', [item?.id])).rows[0]
        .audience,
    ).toBe('adults');
    const deniedUpdate = await scene.as('boris', (tx) =>
      tx
        .update(noteItems)
        .set({ title: 'обход корзины' })
        .where(eq(noteItems.id, item?.id ?? '')),
    );
    expect(deniedUpdate.rowCount).toBe(0);
  });
  it('копия любого читателя — новая личная запись без истории', async () => {
    const id = await make();
    for (const key of ['anna', 'boris', 'vera', 'dina', 'mila', 'gleb'] as const) {
      const person = scene.person(key);
      const facts: RecordFacts = {
        type: 'note',
        authorId: scene.person('boris').id,
        placement: scene.home('household'),
      };
      const result = await scene.as(key, async (tx) => {
        const [source] = await tx.select().from(notes).where(eq(notes.id, id));
        if (!source) return false;
        const [copy] = await tx
          .insert(notes)
          .values({
            title: source.title,
            body: source.body,
            authorId: person.id,
            spaceId: person.personalSpaceId,
            spaceKind: 'personal',
          })
          .returning();
        expect(
          await tx
            .select()
            .from(notesHistory)
            .where(eq(notesHistory.recordId, copy?.id ?? '')),
        ).toHaveLength(0);
        return !!copy;
      });
      expect(result).toBe(canCopyToPersonal(person.viewer, facts));
    }
  });
  it('ослабленная политика чтения делает проверку чужого личного красной', async () => {
    const id = await make(false);
    try {
      await db.admin.query('ALTER POLICY notes_select ON notes USING (true)');
      expect(
        await scene.as('anna', (tx) => tx.select().from(notes).where(eq(notes.id, id))),
      ).toHaveLength(1);
      // Эталон разрешает только владельцу: матрица сравнивает именно этот ответ с canView.
      expect(
        canCopyToPersonal(scene.person('anna').viewer, {
          type: 'note',
          placement: scene.personal('boris'),
          authorId: scene.person('boris').id,
        }),
      ).toBe(false);
    } finally {
      await db.admin.query(`ALTER POLICY notes_select ON notes USING (${canViewSql()})`);
    }
    expect(
      await scene.as('anna', (tx) => tx.select().from(notes).where(eq(notes.id, id))),
    ).toHaveLength(0);
  });
  it('параллельная чужая правка и перенос не оставляют чужой вклад в личном', async () => {
    const id = await make();
    const results = await Promise.allSettled([
      scene.as('anna', (tx) =>
        tx.update(notes).set({ body: 'совместный вклад' }).where(eq(notes.id, id)),
      ),
      privatize(id),
    ]);
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    const row = (
      await db.admin.query(
        'SELECT space_kind, body, has_other_contributions FROM notes WHERE id=$1',
        [id],
      )
    ).rows[0];
    expect(row.space_kind === 'personal' && row.body === 'совместный вклад').toBe(false);
  });
});
