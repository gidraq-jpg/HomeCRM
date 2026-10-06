// История изменений (OBJ-6): пишет база, а не приложение; видна тем же, кому видна запись;
// следует за записью при смене аудитории и переносе; уходит вместе с записью при очистке корзины.
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { notes, notesHistory } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import type { PersonKey } from './testing/family.ts';
import { addNote, createScene, rowsOf, type Scene } from './testing/helpers.ts';
import { isDenied } from './testing/matrix.ts';

let database: TestDatabase;
let scene: Scene;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(database);
});

afterAll(async () => {
  await database?.drop();
});

type Event = {
  operation: string;
  actor_id: string | null;
  changes: Record<string, { old?: unknown; new?: unknown }>;
};

/** Все события записи так, как их хранит база (читает суперпользователь). */
const eventsOf = (id: string) =>
  rowsOf<Event>(
    database.admin,
    `SELECT operation, actor_id, changes FROM notes_history WHERE record_id = $1 ORDER BY created_at, id`,
    [id],
  );

/** Сколько событий записи видит участник: через настоящее приложение, без фильтра в коде. */
const seenBy = async (who: PersonKey, id: string): Promise<number> =>
  (
    await scene.as(who, (tx) =>
      tx.select({ id: notesHistory.id }).from(notesHistory).where(eq(notesHistory.recordId, id)),
    )
  ).length;

const columnsOf = (placement: ReturnType<Scene['home']>) => ({
  spaceId: placement.spaceId,
  spaceKind: placement.kind,
  audience: placement.kind === 'household' ? placement.audience : null,
});

describe('что и кем записывается', () => {
  it('создание и правка общей записи: кто, какие поля, старое и новое значение', async () => {
    const boris = scene.person('boris');
    const [created] = await scene.as('boris', (tx) =>
      tx
        .insert(notes)
        .values({
          ...columnsOf(scene.home('household')),
          authorId: boris.id,
          title: 'Квитанция за октябрь',
          body: 'сумма уточняется',
        })
        .returning({ id: notes.id }),
    );
    const id = created?.id ?? '';
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'Квитанция за ноябрь' }).where(eq(notes.id, id)),
    );
    // Тот же текст ещё раз — изменения нет, события тоже.
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'Квитанция за ноябрь' }).where(eq(notes.id, id)),
    );

    const events = await eventsOf(id);
    expect(events.map((event) => event.operation)).toEqual(['create', 'update']);
    expect(events[0]?.actor_id).toBe(boris.id);
    expect(events[0]?.changes.title).toEqual({ new: 'Квитанция за октябрь' });
    expect(events[0]?.changes.body).toEqual({ new: 'сумма уточняется' });
    expect(events[1]?.actor_id).toBe(scene.person('anna').id);
    // Только изменённые поля: ни времени изменения, ни служебных ключей.
    expect(events[1]?.changes).toEqual({
      title: { old: 'Квитанция за октябрь', new: 'Квитанция за ноябрь' },
    });
  });

  it('корзина и восстановление — отдельные события', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
    });
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id)),
    );
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ deletedAt: null }).where(eq(notes.id, id)),
    );
    const events = await eventsOf(id);
    expect(events.map((event) => event.operation)).toEqual(['create', 'trash', 'restore']);
    expect(events[1]?.actor_id).toBe(scene.person('boris').id);
    expect(Object.keys(events[1]?.changes ?? {})).toEqual(['deleted_at']);
  });

  it('у личных записей истории нет: ни создания, ни правок, ни корзины', async () => {
    const [created] = await scene.as('boris', (tx) =>
      tx
        .insert(notes)
        .values({
          ...columnsOf(scene.personal('boris')),
          authorId: scene.person('boris').id,
          title: 'личное',
        })
        .returning({ id: notes.id }),
    );
    const id = created?.id ?? '';
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ title: 'личное 2' }).where(eq(notes.id, id)),
    );
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ deletedAt: new Date() }).where(eq(notes.id, id)),
    );
    expect(await eventsOf(id)).toEqual([]);
  });
});

describe('кто видит историю — те же, кому видна запись', () => {
  it('«Вся семья»: все участники дома; посторонний и участник другого дома — нет', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
    });
    const counts = await Promise.all(
      (['anna', 'boris', 'vera', 'mila', 'dina', 'gleb'] as const).map((who) => seenBy(who, id)),
    );
    expect(counts).toEqual([1, 1, 1, 1, 0, 0]);
  });

  it('«Взрослые»: администратор и взрослый; ребёнок — нет, даже если он автор или ответственный раньше', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('adults'),
    });
    const counts = await Promise.all(
      (['anna', 'boris', 'vera', 'mila', 'dina', 'gleb'] as const).map((who) => seenBy(who, id)),
    );
    expect(counts).toEqual([1, 1, 0, 0, 0, 0]);
    // У Милы в соседнем доме роль взрослой, но этого дома она — ребёнок.
    const neighbours = await addNote(database.admin, {
      author: scene.person('dina'),
      placement: scene.neighbours('adults'),
    });
    expect(await seenBy('mila', neighbours)).toBe(1);
  });

  it('«Сделать личной»: история уходит из дома вместе с записью и видна только владельцу', async () => {
    const anna = scene.person('anna');
    const id = await addNote(database.admin, {
      author: anna,
      placement: scene.home('household'),
    });
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'правка' }).where(eq(notes.id, id)),
    );
    const personal = scene.personal('anna');
    await scene.as('anna', (tx) =>
      tx.update(notes).set(columnsOf(personal)).where(eq(notes.id, id)),
    );
    expect(await seenBy('boris', id)).toBe(0);
    expect(await seenBy('vera', id)).toBe(0);
    // Администратор — тоже не «суперпользователь» для чужого личного, но тут оно её собственное.
    expect(await seenBy('anna', id)).toBe(3);
    const events = await eventsOf(id);
    expect(events.at(-1)?.operation).toBe('move');
  });

  it('смена аудитории: прошлое видят те, кто видел его тогда; суженные теряют историю, расширенные — не получают старую (PRD 7.3.7, 7.3.8)', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
    });
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'правка' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(2);

    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'adults' }).where(eq(notes.id, id)),
    );
    // Запись и вся история ребёнку закрыты; взрослые видят всё.
    expect(await seenBy('vera', id)).toBe(0);
    expect(await seenBy('boris', id)).toBe(3);
    expect((await eventsOf(id)).map((event) => event.operation)).toEqual([
      'create',
      'update',
      'audience',
    ]);

    // Расширили обратно: ребёнок видит запись и то, что при её создании и правке было ему открыто.
    // Событие смены аудитории стоит на «Взрослых» — оно остаётся им.
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'household' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(2);
    expect(await seenBy('boris', id)).toBe(4);
  });

  it('расширение аудитории не открывает ребёнку прошлое «Взрослых»: прежние тексты в истории остаются закрытыми', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('adults'),
      title: 'секрет',
    });
    await scene.as('anna', (tx) => tx.update(notes).set({ title: 'план' }).where(eq(notes.id, id)));
    // Открыли всей семье отдельным запросом.
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ audience: 'household' }).where(eq(notes.id, id)),
    );
    const textsSeenBy = async (who: PersonKey) =>
      JSON.stringify(
        await scene.as(who, (tx) =>
          tx
            .select({ changes: notesHistory.changes })
            .from(notesHistory)
            .where(eq(notesHistory.recordId, id)),
        ),
      );
    // Ребёнок читает запись, но историю до открытия — нет: ни «секрет», ни «план».
    expect(
      await scene.as('vera', (tx) => tx.select().from(notes).where(eq(notes.id, id))),
    ).toHaveLength(1);
    expect(await seenBy('vera', id)).toBe(0);
    expect(await textsSeenBy('vera')).not.toMatch(/секрет|план/);
    // Взрослые видят всё.
    expect(await seenBy('boris', id)).toBe(3);
    expect(await textsSeenBy('boris')).toMatch(/секрет/);

    // Что изменили после открытия — видно всем, кто видит запись.
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'для всех' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(1);
    expect(await textsSeenBy('vera')).toMatch(/для всех/);
    // «План» в этом событии — название на момент открытия, оно уже видно ребёнку в самой записи.
    expect(await textsSeenBy('vera')).not.toMatch(/секрет/);
  });

  it('правка и расширение аудитории одним запросом: старый текст ребёнку не достаётся', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('adults'),
      title: 'только взрослым',
    });
    await scene.as('boris', (tx) =>
      tx.update(notes).set({ title: 'для всех', audience: 'household' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(0);
    expect(await seenBy('boris', id)).toBe(2);
  });

  it('перенос между домами: прошлое видят только те, кто видел его в прежнем доме и видит запись теперь', async () => {
    const mila = scene.person('mila');
    // Мила — взрослая у соседей и ребёнок в «Доме»: запись «Вся семья» видна ей в обоих домах.
    const id = await addNote(database.admin, {
      author: mila,
      placement: scene.neighbours('household'),
      title: 'у соседей',
    });
    await scene.as('dina', (tx) =>
      tx.update(notes).set({ title: 'у соседей, правка' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('dina', id)).toBe(2);
    expect(await seenBy('anna', id)).toBe(0);

    const home = scene.home('household');
    await database.admin.query(
      `UPDATE notes SET space_id = $2, audience = 'household' WHERE id = $1`,
      [id, home.spaceId],
    );
    expect((await eventsOf(id)).map((event) => event.operation)).toEqual([
      'create',
      'update',
      'move',
    ]);
    // «Дом» видит запись, но не то, что с ней было у соседей; соседи записи больше не видят вовсе.
    expect(
      await scene.as('anna', (tx) => tx.select().from(notes).where(eq(notes.id, id))),
    ).toHaveLength(1);
    expect(await seenBy('anna', id)).toBe(0);
    expect(await seenBy('vera', id)).toBe(0);
    expect(await seenBy('dina', id)).toBe(0);
    // Мила состоит в обоих домах и видела прошлое у соседей.
    expect(await seenBy('mila', id)).toBe(3);
    // Дальше история идёт уже в «Доме».
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'теперь у нас' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(1);
    expect(await seenBy('dina', id)).toBe(0);
  });

  it('«Поделиться»: личный период и сам перенос остаются у владельца, дальше история идёт для дома', async () => {
    const [created] = await scene.as('boris', (tx) =>
      tx
        .insert(notes)
        .values({
          ...columnsOf(scene.personal('boris')),
          authorId: scene.person('boris').id,
          title: 'личное',
        })
        .returning({ id: notes.id }),
    );
    const id = created?.id ?? '';
    await scene.as('boris', (tx) =>
      tx
        .update(notes)
        .set(columnsOf(scene.home('household')))
        .where(eq(notes.id, id)),
    );
    expect((await eventsOf(id)).map((event) => event.operation)).toEqual(['move']);
    // Событие переноса стоит на личном месте: дому оно закрыто, чтобы вместе с ним не открылись
    // старые значения полей, изменённых тем же запросом.
    expect(await seenBy('vera', id)).toBe(0);
    expect(await seenBy('anna', id)).toBe(0);
    expect(await seenBy('boris', id)).toBe(1);
    await scene.as('anna', (tx) =>
      tx.update(notes).set({ title: 'правка дома' }).where(eq(notes.id, id)),
    );
    expect(await seenBy('vera', id)).toBe(1);
    expect(await seenBy('anna', id)).toBe(1);
  });
});

describe('историю пишет только база', () => {
  it('приложение не вставляет, не меняет и не удаляет события — ни напрямую, ни из блока кода', async () => {
    const anna = scene.person('anna');
    const home = scene.home('household');
    const id = await addNote(database.admin, { author: anna, placement: home });
    const insert = sql`INSERT INTO notes_history (record_id, space_id, space_kind, audience, actor_id, operation, changes)
      VALUES (${id}, ${home.spaceId}, 'household', 'household', ${anna.id}, 'update', '{"title":{"old":"a","new":"b"}}')`;
    await expect(scene.as('anna', (tx) => tx.execute(insert))).rejects.toSatisfy(isDenied);
    // Блок DO — не триггер: глубина вызова нулевая, политика не пускает.
    await expect(
      scene.as('anna', (tx) =>
        tx.execute(
          sql`DO $$ BEGIN INSERT INTO notes_history (record_id, space_id, space_kind, audience, operation, changes)
            VALUES (${sql.raw(`'${id}'`)}, ${sql.raw(`'${home.spaceId}'`)}, 'household', 'household', 'update', '{}'); END $$`,
        ),
      ),
    ).rejects.toSatisfy(isDenied);
    for (const statement of [
      sql`UPDATE notes_history SET changes = '{}'`,
      sql`DELETE FROM notes_history`,
      sql`TRUNCATE notes_history`,
    ]) {
      await expect(scene.as('anna', (tx) => tx.execute(statement))).rejects.toSatisfy(isDenied);
    }
    // Обработчик тоже не пишет историю напрямую.
    await expect(
      database.worker.query(
        `INSERT INTO notes_history (record_id, space_id, space_kind, audience, operation, changes)
         VALUES ($1, $2, 'household', 'household', 'update', '{}')`,
        [id, home.spaceId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    expect(await eventsOf(id)).toHaveLength(1);
  });

  it('при очистке корзины история уходит вместе с записью', async () => {
    const id = await addNote(database.admin, {
      author: scene.person('anna'),
      placement: scene.home('household'),
      trashedDaysAgo: 31,
    });
    expect(await eventsOf(id)).toHaveLength(1);
    const purged = await database.worker.query('DELETE FROM notes WHERE id = $1', [id]);
    expect(purged.rowCount).toBe(1);
    expect(await eventsOf(id)).toEqual([]);
  });
});
