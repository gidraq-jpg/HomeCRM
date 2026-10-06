// OBJ-2: пары пространств и видов, включая случаи «видит только один конец».
import { randomUUID } from 'node:crypto';
import { canViewLink, canViewTimelineEvent, canWriteLink, type RecordFacts } from '@homecrm/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { objectEvents, objectFields, objects, RECORD_TABLES, recordLinks } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, errorChain, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
const records: { id: string; table: string; facts: RecordFacts }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
  for (const placement of scene.family.placements) {
    const authorId =
      placement.kind === 'personal'
        ? placement.ownerId
        : placement.spaceId === scene.home('household').spaceId
          ? scene.person('anna').id
          : scene.person('dina').id;
    for (const type of ['object', 'note', 'task', 'shopping_item'] as const) {
      const table = RECORD_TABLES[type];
      const { getTableName } = await import('drizzle-orm');
      const name = getTableName(table);
      const result = await db.admin.query(
        `INSERT INTO ${name} (space_id, space_kind, audience, author_id, title) VALUES ($1,$2,$3,$4,'Вымышленная запись') RETURNING id, assignee_id`,
        [
          placement.spaceId,
          placement.kind,
          placement.kind === 'household' ? placement.audience : null,
          authorId,
        ],
      );
      records.push({
        id: result.rows[0].id,
        table: name,
        facts: { placement, type, authorId, assigneeId: result.rows[0].assignee_id },
      });
    }
  }
});
afterAll(async () => {
  await db?.drop();
});

async function linkMatrix() {
  const mismatches: string[] = [];
  let checks = 0;
  const pairs = records
    .filter((r) => r.table === 'objects')
    .flatMap((left) =>
      records.filter((r) => r.id !== left.id).map((right) => ({ left, right, id: randomUUID() })),
    );
  await db.admin.query('ALTER TABLE record_links DISABLE TRIGGER record_links_guard');
  try {
    for (const { left, right, id } of pairs)
      await db.admin.query(
        'INSERT INTO record_links(id,left_table,left_id,right_table,right_id,author_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, left.table, left.id, right.table, right.id, left.facts.authorId],
      );
  } finally {
    await db.admin.query('ALTER TABLE record_links ENABLE TRIGGER record_links_guard');
  }
  let next = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (next < pairs.length) {
        const pair = pairs[next++];
        if (!pair) continue;
        const { left, right, id } = pair;
        for (const person of scene.family.people) {
          const seen = await scene.as(person.key, (tx) =>
            tx.select().from(recordLinks).where(eq(recordLinks.id, id)),
          );
          checks++;
          if ((seen.length === 1) !== canViewLink(person.viewer, left.facts, right.facts))
            mismatches.push(`${person.key}: view ${left.table}/${right.table}`);
          const expected = canWriteLink(person.viewer, left.facts, right.facts);
          for (const operation of ['create', 'edit', 'trash'] as const) {
            let allowed = false;
            try {
              await scene.as(person.key, async (tx) => {
                await tx.execute(sql`SAVEPOINT attempt`);
                if (operation === 'create') {
                  await tx.insert(recordLinks).values({
                    leftTable: left.table,
                    leftId: left.id,
                    rightTable: right.table,
                    rightId: right.id,
                    authorId: person.id,
                  });
                  allowed = true;
                } else {
                  const changed = await tx
                    .update(recordLinks)
                    .set(operation === 'edit' ? { role: 'Проверка' } : { deletedAt: new Date() })
                    .where(eq(recordLinks.id, id));
                  allowed = changed.rowCount === 1;
                }
                await tx.execute(sql`ROLLBACK TO SAVEPOINT attempt`);
              });
            } catch (error) {
              if (!hasCode(error, ['42501'])) throw error;
            }
            checks++;
            if (allowed !== expected)
              mismatches.push(
                `${person.key}: ${operation} ${left.facts.placement.spaceId}/${right.facts.placement.spaceId}`,
              );
          }
        }
      }
    }),
  );
  await db.admin.query('DELETE FROM record_links');
  return { checks, mismatches };
}
it('матрица пар совпадает с эталоном, без раскрытия второго конца', async () => {
  const report = await linkMatrix();
  console.info(`Матрица связей: ${report.checks} проверок`);
  expect(report.mismatches).toEqual([]);
}, 120_000);
it('ослабленная политика чтения связи роняет матрицу видимости', async () => {
  const left = records[0];
  const right = records.find(
    (r) =>
      r.facts.placement.kind === 'personal' &&
      r.facts.placement.ownerId === scene.person('boris').id,
  );
  if (!left || !right) throw new Error('Missing pair');
  await db.admin.query('ALTER TABLE record_links DISABLE TRIGGER record_links_guard');
  const result = await db.admin.query(
    'INSERT INTO record_links(left_table,left_id,right_table,right_id,author_id) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [left.table, left.id, right.table, right.id, left.facts.authorId],
  );
  await db.admin.query('ALTER TABLE record_links ENABLE TRIGGER record_links_guard');
  try {
    await db.owner.query('ALTER POLICY record_links_select ON record_links USING (true)');
    const seen = await scene.as('vera', (tx) =>
      tx.select().from(recordLinks).where(eq(recordLinks.id, result.rows[0].id)),
    );
    expect(seen.length === 1).not.toBe(
      canViewLink(scene.person('vera').viewer, left.facts, right.facts),
    );
  } finally {
    await db.owner.query(
      'ALTER POLICY record_links_select ON record_links USING (app.record_ref_allowed(left_table,left_id,false) AND app.record_ref_allowed(right_table,right_id,false))',
    );
  }
});
it('скрытый и отсутствующий родитель одинаково отказаны ребёнку до отложенного FK', async () => {
  const hidden = records.find(
    (r) =>
      r.table === 'notes' &&
      r.facts.placement.kind === 'personal' &&
      r.facts.placement.ownerId === scene.person('boris').id,
  );
  if (!hidden) throw new Error('Missing hidden note');
  const failures: string[] = [];
  for (const id of [hidden.id, randomUUID()])
    try {
      await scene.as('vera', (tx) =>
        tx.execute(
          sql`INSERT INTO note_items(parent_id,space_id,space_kind,author_id,title) VALUES (${id},${scene.person('vera').personalSpaceId},'personal',${scene.person('vera').id},'Вымышленный пункт')`,
        ),
      );
      throw new Error('Unexpected success');
    } catch (error) {
      expect(hasCode(error, ['42501'])).toBe(true);
      expect(hasCode(error, ['23503'])).toBe(false);
      failures.push(errorChain(error));
    }
  expect(failures[0]).toEqual(failures[1]);
});
it('события и их история требуют текущего и прежнего доступа; чужой вклад запрещает перенос', async () => {
  const author = scene.person('boris');
  const [object] = await scene.as('boris', (tx) =>
    tx
      .insert(objects)
      .values({
        ...placementColumns(scene.home('adults')),
        authorId: author.id,
        title: 'Вымышленная техника',
      })
      .returning(),
  );
  if (!object) throw new Error('Missing object');
  await scene.as('boris', (tx) =>
    tx.insert(objectEvents).values({
      ...placementColumns(scene.home('adults')),
      parentId: object.id,
      authorId: author.id,
      title: 'Закрытое событие',
      originSpaceId: object.spaceId,
      originSpaceKind: 'household',
    }),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ audience: 'household' }).where(eq(objects.id, object.id)),
  );
  const facts: RecordFacts = {
    placement: scene.home('household'),
    type: 'object',
    authorId: author.id,
  };
  for (const person of scene.family.people) {
    const seen = await scene.as(person.key, (tx) =>
      tx.select().from(objectEvents).where(eq(objectEvents.parentId, object.id)),
    );
    expect(seen.length === 1).toBe(
      canViewTimelineEvent(person.viewer, facts, scene.home('adults')),
    );
  }
  await scene.as('anna', (tx) =>
    tx.insert(objectFields).values({
      ...placementColumns(scene.home('household')),
      parentId: object.id,
      authorId: scene.person('anna').id,
      title: 'Модель',
      value: 'Вымышленная',
    }),
  );
  await expect(
    scene.as('boris', (tx) =>
      tx
        .update(objects)
        .set(placementColumns(scene.personal('boris')))
        .where(eq(objects.id, object.id)),
    ),
  ).rejects.toSatisfy((error: unknown) => hasCode(error, ['42501']));
});
