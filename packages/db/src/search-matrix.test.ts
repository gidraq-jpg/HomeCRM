import { randomUUID } from 'node:crypto';
import { canView, canViewTimelineEvent, type Placement } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { setSearchQuery } from './search.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(db.admin, family);
});
afterAll(async () => {
  await db?.drop();
});
const sources = new Set([
  'note',
  'note_item',
  'object',
  'object_field',
  'object_event',
  'meter',
  'document',
]);
it('матрица индекса: все участники × записи; чужое личное, взрослые и корзина скрыты до счётчика', async () => {
  const app = createAppDatabase(db.app);
  let checks = 0;
  for (const person of family.people) {
    const expected = family.records
      .filter((r) => sources.has(r.type) && !r.trashed && canView(person.viewer, r.facts.placement))
      .map((r) => r.id)
      .sort();
    const rows = await app.withAccount(person.id, async (tx) => {
      // Матрица проверяет доступ независимо от конкретного текста запроса.
      await tx.execute(sql`SELECT set_config('app.search_pattern','%',true)`);
      return (await tx.execute<{ source_id: string }>(sql`SELECT source_id FROM search_index`))
        .rows;
    });
    expect(rows.map((r) => r.source_id).sort(), person.name).toEqual(expected);
    checks += family.records.filter((r) => sources.has(r.type)).length;
  }
  expect(checks).toBeGreaterThan(100);
  console.info(`Search access matrix: ${checks} checks, 0 mismatches`);
});
it('индекс нельзя подделать, переписать, очистить или вызвать закрытый триггер', async () => {
  for (const pool of [db.app, db.auth, db.worker]) {
    for (const query of [
      'DELETE FROM search_index',
      "UPDATE search_index SET title='forged'",
      "INSERT INTO search_index(source_type) VALUES ('forged')",
      'TRUNCATE search_index',
      'SELECT app.sync_search_entry()',
    ]) {
      await expect(pool.query(query)).rejects.toMatchObject({ code: '42501' });
    }
  }
  expect((await db.owner.query('SELECT * FROM search_index')).rows).toEqual([]);
});

it('матрица исторической аудитории: событие после открытия объекта; живой видимый родитель обязателен даже для устаревшей строки', async () => {
  const anna = family.person('anna'),
    boris = family.person('boris');
  const origin: Placement = { kind: 'personal', spaceId: anna.personalSpaceId, ownerId: anna.id };
  const current: Placement = {
    kind: 'household',
    spaceId: family.houses[0]?.id ?? '',
    audience: 'household',
  };
  const object = (
    await db.admin.query(
      `INSERT INTO objects(space_id,space_kind,author_id,title) VALUES($1,'personal',$2,'Объект матрицы снимка') RETURNING id`,
      [anna.personalSpaceId, anna.id],
    )
  ).rows[0].id as string;
  const event = (
    await db.admin.query(
      `INSERT INTO object_events(space_id,space_kind,author_id,title,parent_id) VALUES($1,'personal',$2,'Событие матрицы снимка',$3) RETURNING id`,
      [anna.personalSpaceId, anna.id, object],
    )
  ).rows[0].id as string;
  const app = createAppDatabase(db.app);
  await app.withAccount(anna.id, (tx) =>
    tx.execute(
      sql`UPDATE objects SET space_id=${current.spaceId},space_kind='household',audience='household' WHERE id=${object}`,
    ),
  );
  const sees = async (person: typeof anna) =>
    app.withAccount(person.id, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.search_pattern','%',true)`);
      return (
        (
          await tx.execute(
            sql`SELECT source_id FROM search_index WHERE source_type='object_event' AND source_id=${event}`,
          )
        ).rows.length === 1
      );
    });
  for (const person of family.people)
    expect(await sees(person), person.name).toBe(
      canViewTimelineEvent(
        person.viewer,
        {
          type: 'object_event',
          placement: current,
          authorId: anna.id,
          assigneeId: anna.id,
          trashed: false,
        },
        origin,
      ),
    );
  await db.admin.query('UPDATE search_index SET target_id=$1 WHERE source_id=$2', [
    randomUUID(),
    event,
  ]);
  expect(await sees(anna)).toBe(false);
  const hidden = (
    await db.admin.query(
      `INSERT INTO objects(space_id,space_kind,author_id,title) VALUES($1,'personal',$2,'Чужой родитель') RETURNING id`,
      [boris.personalSpaceId, boris.id],
    )
  ).rows[0].id;
  await db.admin.query('UPDATE search_index SET target_id=$1 WHERE source_id=$2', [hidden, event]);
  expect(await sees(anna)).toBe(false);
});

it('поисковый контекст не переживает транзакцию; откат записи откатывает и индекс', async () => {
  const pool = db.pool('app', 1),
    app = createAppDatabase(pool),
    anna = family.person('anna');
  await app.withAccount(anna.id, async (tx) => {
    await setSearchQuery(tx, 'матрицы');
  });
  expect((await pool.query('SELECT * FROM search_index')).rows).toEqual([]);
  const id = randomUUID();
  await expect(
    app.withAccount(anna.id, async (tx) => {
      await tx.execute(
        sql`INSERT INTO notes(id,space_id,space_kind,author_id,title) VALUES(${id},${anna.personalSpaceId},'personal',${anna.id},'Откат индекса')`,
      );
      throw new Error('rollback search fixture');
    }),
  ).rejects.toThrow('rollback search fixture');
  expect(
    (await db.admin.query('SELECT * FROM search_index WHERE source_id=$1', [id])).rows,
  ).toEqual([]);
});
