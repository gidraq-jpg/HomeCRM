// Правила записи, общие для всех таблиц записей (R0.1): автор, неизменяемые поля, корзина,
// ответственный по правилу 9. Каждый случай — пункт бэклога ревью 0.4 или правило PRD 7.3.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { notes, tasks } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import type { PersonKey } from './testing/family.ts';
import { addNote, createScene, rowsOf, type Scene } from './testing/helpers.ts';
import { hasCode, isDenied } from './testing/matrix.ts';

let database: TestDatabase;
let scene: Scene;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(database);
});

afterAll(async () => {
  await database?.drop();
});

const FOREIGN_KEY = ['23503'];

describe('автор записи (PRD 6.2)', () => {
  it('при создании автор — текущий участник: от чужого имени записи не создают', async () => {
    const anna = scene.person('anna');
    await expect(
      scene.as('boris', (tx) =>
        tx.insert(notes).values({
          ...columnsOf(scene.home('household')),
          authorId: anna.id,
          title: 'от имени Анны',
        }),
      ),
    ).rejects.toSatisfy(isDenied);
    const own = await scene.as('boris', (tx) =>
      tx
        .insert(notes)
        .values({
          ...columnsOf(scene.home('household')),
          authorId: scene.person('boris').id,
          title: 'моя',
        })
        .returning({ id: notes.id }),
    );
    expect(own).toHaveLength(1);
  });

  it('автора, id и время создания не меняет никто — ни автор, ни администратор, ни владелец таблиц', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('boris'),
      placement: scene.home('household'),
    });
    for (const who of ['boris', 'anna'] as const) {
      for (const change of [
        { authorId: scene.person('vera').id },
        { createdAt: new Date('2000-01-01T00:00:00Z') },
        { id: crypto.randomUUID() },
      ]) {
        await expect(
          scene.as(who, (tx) => tx.update(notes).set(change).where(eq(notes.id, id))),
          `${who}: ${Object.keys(change)}`,
        ).rejects.toSatisfy(isDenied);
      }
    }
    // Права на колонки — первый рубеж, триггер — второй: суперпользователь тоже упирается в триггер.
    for (const statement of [
      `UPDATE notes SET author_id = '${scene.person('vera').id}' WHERE id = '${id}'`,
      `UPDATE notes SET created_at = now() - interval '1 year' WHERE id = '${id}'`,
      `UPDATE notes SET id = gen_random_uuid() WHERE id = '${id}'`,
    ]) {
      await expect(database.admin.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
  });

  it('время создания и изменения ставит база, что бы ни прислало приложение', async () => {
    const [created] = await scene.as('boris', (tx) =>
      tx
        .insert(notes)
        .values({
          ...columnsOf(scene.home('household')),
          authorId: scene.person('boris').id,
          title: 'с прошлым',
          createdAt: new Date('2000-01-01T00:00:00Z'),
          updatedAt: new Date('2000-01-01T00:00:00Z'),
        })
        .returning({ id: notes.id, createdAt: notes.createdAt, updatedAt: notes.updatedAt }),
    );
    expect(created?.createdAt.getFullYear()).toBeGreaterThan(2025);
    expect(created?.updatedAt.getFullYear()).toBeGreaterThan(2025);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const [changed] = await scene.as('boris', (tx) =>
      tx
        .update(notes)
        .set({ title: 'правка' })
        .where(eq(notes.id, created?.id ?? ''))
        .returning({ createdAt: notes.createdAt, updatedAt: notes.updatedAt }),
    );
    expect(changed?.createdAt).toEqual(created?.createdAt);
    expect(changed?.updatedAt.getTime()).toBeGreaterThan(created?.updatedAt.getTime() ?? 0);
  });
});

describe('корзина (DATA-1)', () => {
  it('запись в корзине нельзя ни править, ни переносить — только восстановить', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
      trashedDaysAgo: 1,
    });
    const personal = scene.personal('anna');
    // Анна — администратор: восстанавливать ей можно, поэтому политика пустила бы правку.
    for (const change of [
      { title: 'правка в корзине' },
      { spaceId: personal.spaceId, spaceKind: 'personal' as const, audience: null },
      { audience: 'adults' as const },
    ]) {
      await expect(
        scene.as('anna', (tx) => tx.update(notes).set(change).where(eq(notes.id, id))),
        JSON.stringify(Object.keys(change)),
      ).rejects.toSatisfy(isDenied);
    }
    // Восстановление вместе с правкой — тоже нет: сначала восстановить, потом править.
    await expect(
      scene.as('anna', (tx) =>
        tx.update(notes).set({ deletedAt: null, title: 'тихо' }).where(eq(notes.id, id)),
      ),
    ).rejects.toSatisfy(isDenied);
    const restored = await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, id)),
    );
    expect(restored.rowCount).toBe(1);
    const edited = await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'правка после восстановления' }).where(eq(notes.id, id)),
    );
    expect(edited.rowCount).toBe(1);
  });

  it('новую запись сразу в корзину создать нельзя', async () => {
    await expect(
      scene.as('anna', (tx) =>
        tx.insert(notes).values({
          ...columnsOf(scene.home('household')),
          authorId: scene.person('anna').id,
          title: 'сразу в корзину',
          deletedAt: new Date(),
        }),
      ),
    ).rejects.toSatisfy(isDenied);
  });
});

describe('ответственный (PRD 7.3.9)', () => {
  const assignee = async (
    creator: PersonKey,
    place: ReturnType<Scene['home']>,
    chosen: string | null,
  ) =>
    scene.as(creator, async (tx) => {
      const [row] = await tx
        .insert(tasks)
        .values({
          ...columnsOf(place),
          authorId: scene.person(creator).id,
          assigneeId: chosen,
          title: 'дело',
        })
        .returning({ assigneeId: tasks.assigneeId });
      return row?.assigneeId;
    });

  it('в личном всегда владелец, кого бы ни назвали', async () => {
    const vera = scene.person('vera');
    expect(await assignee('vera', scene.personal('vera'), null)).toBe(vera.id);
    expect(await assignee('vera', scene.personal('vera'), scene.person('anna').id)).toBe(vera.id);
  });

  it('в общем — назначенный, а если не назначен, то автор', async () => {
    expect(await assignee('boris', scene.home('household'), null)).toBe(scene.person('boris').id);
    expect(await assignee('boris', scene.home('household'), scene.person('vera').id)).toBe(
      scene.person('vera').id,
    );
  });

  it('во «Взрослых» — только взрослый; ребёнок, посторонний и участник другого дома не подойдут', async () => {
    const place = scene.home('adults');
    expect(await assignee('anna', place, scene.person('boris').id)).toBe(scene.person('boris').id);
    // Мила в этом доме — ребёнок, хотя у соседей она взрослая: роль берётся по дому записи.
    for (const who of ['vera', 'mila', 'gleb', 'dina'] as const) {
      await expect(assignee('anna', place, scene.person(who).id), who).rejects.toSatisfy((error) =>
        hasCode(error, FOREIGN_KEY),
      );
    }
    // У соседей Мила — взрослая: там ей можно.
    expect(await assignee('dina', scene.neighbours('adults'), scene.person('mila').id)).toBe(
      scene.person('mila').id,
    );
  });

  it('в «Вся семья» подойдёт любой участник дома, но не посторонний и не участник чужого дома', async () => {
    const place = scene.home('household');
    expect(await assignee('anna', place, scene.person('vera').id)).toBe(scene.person('vera').id);
    for (const who of ['gleb', 'dina'] as const) {
      await expect(assignee('anna', place, scene.person(who).id), who).rejects.toSatisfy((error) =>
        hasCode(error, FOREIGN_KEY),
      );
    }
  });

  it('смена аудитории на «Взрослые» невозможна, пока ответственный — ребёнок', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
      assigneeId: scene.person('vera').id,
    });
    await expect(
      scene.as('anna', (tx) =>
        tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, id)),
      ),
    ).rejects.toSatisfy((error) => hasCode(error, FOREIGN_KEY));
    const moved = await scene.as('anna', (tx) =>
      tx
        .update(notes)
        .set({ audience: 'adults', assigneeId: scene.person('boris').id })
        .where(eq(notes.id, id)),
    );
    expect(moved.rowCount).toBe(1);
  });
});

describe('права обработчика на колонки', () => {
  it('обработчик не читает тексты записей и не меняет ничего, кроме ответственного', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.personal('anna'),
      title: 'секретное название',
      trashedDaysAgo: 40,
    });
    // Просроченное он видит и удаляет, но только id и отметку корзины.
    const seen = await database.worker.query('SELECT id, deleted_at FROM notes WHERE id = $1', [
      id,
    ]);
    expect(seen.rows).toHaveLength(1);
    for (const statement of [
      'SELECT title FROM notes',
      'SELECT author_id FROM notes',
      'SELECT * FROM notes',
      `UPDATE notes SET title = 'x'`,
      'UPDATE notes SET deleted_at = NULL',
    ]) {
      await expect(database.worker.query(statement), statement).rejects.toMatchObject({
        code: '42501',
      });
    }
    const removed = await database.worker.query('DELETE FROM notes WHERE id = $1', [id]);
    expect(removed.rowCount).toBe(1);
    expect(await rowsOf(database.admin, 'SELECT id FROM notes WHERE id = $1', [id])).toEqual([]);
  });
});

function columnsOf(placement: ReturnType<Scene['home']>) {
  return {
    spaceId: placement.spaceId,
    spaceKind: placement.kind,
    audience: placement.kind === 'household' ? placement.audience : null,
  };
}
