import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import {
  createWorkerDatabase,
  eq,
  notes,
  objectEvents,
  objectFields,
  objects,
  recordLinks,
  sql,
} from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
it('создание связи с читаемым концом ждёт очистку и не оставляет осиротевшую строку', async () => {
  const { rows } = await db.admin.query<{ id: string }>(
    `INSERT INTO objects(space_id,space_kind,audience,author_id,title,deleted_at)
     VALUES ($1,'household','household',$2,'Просроченный объект',now()-interval '31 days') RETURNING id`,
    [scene.home('household').spaceId, scene.person('boris').id],
  );
  const objectId = rows[0]?.id;
  if (!objectId) throw new Error('Missing expired object');
  const [note] = await scene.as('vera', (tx) =>
    tx
      .insert(notes)
      .values({
        ...placementColumns(scene.personal('vera')),
        authorId: scene.person('vera').id,
        title: 'Личное ребёнка',
      })
      .returning(),
  );
  if (!note) throw new Error('Missing personal note');
  const worker = await db.worker.connect();
  const started = Promise.withResolvers<number>();
  let inserting: Promise<unknown> | undefined;
  try {
    await worker.query('BEGIN');
    expect((await worker.query('DELETE FROM objects WHERE id=$1', [objectId])).rowCount).toBe(1);
    inserting = scene
      .as('vera', async (tx) => {
        const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
        started.resolve(pid.rows[0]?.pid ?? 0);
        await tx.insert(recordLinks).values({
          leftTable: 'objects',
          leftId: objectId,
          rightTable: 'notes',
          rightId: note.id,
          authorId: scene.person('vera').id,
        });
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    const pid = await started.promise;
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (!waiting && Date.now() < deadline) {
      const locks = await db.admin.query(
        "SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
        [pid],
      );
      waiting = locks.rowCount === 1;
      if (!waiting) await delay(10);
    }
    expect(waiting).toBe(true);
    await worker.query('COMMIT');
    expect(hasCode(await inserting, ['42501'])).toBe(true);
    expect(
      (
        await db.admin.query(
          'SELECT count(*)::int n FROM record_links WHERE left_id=$1 OR right_id=$1',
          [objectId],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await worker.query('ROLLBACK');
    worker.release();
    await inserting;
  }
});
afterAll(async () => {
  await db?.drop();
});
it('очистка объекта удаляет связи обоих концов и его дочерних строк', async () => {
  const author = scene.person('boris');
  const place = placementColumns(scene.personal('boris'));
  const [object] = await scene.as('boris', (tx) =>
    tx
      .insert(objects)
      .values({ ...place, authorId: author.id, title: 'Объект для корзины' })
      .returning(),
  );
  const [note] = await scene.as('boris', (tx) =>
    tx
      .insert(notes)
      .values({ ...place, authorId: author.id, title: 'Остающаяся заметка' })
      .returning(),
  );
  if (!object || !note) throw new Error('Missing fixtures');
  const [field] = await scene.as('boris', (tx) =>
    tx
      .insert(objectFields)
      .values({ ...place, parentId: object.id, authorId: author.id, title: 'Поле' })
      .returning(),
  );
  if (!field) throw new Error('Missing field');
  const [manual] = await scene.as('boris', (tx) =>
    tx
      .insert(objectEvents)
      .values({
        ...place,
        parentId: object.id,
        authorId: author.id,
        title: 'Удаляемое событие',
        originSpaceId: object.spaceId,
        originSpaceKind: 'personal',
      })
      .returning(),
  );
  const [survivor] = await scene.as('boris', (tx) =>
    tx
      .insert(objects)
      .values({ ...place, authorId: author.id, title: 'Другой объект' })
      .returning(),
  );
  if (!manual || !survivor) throw new Error('Missing event fixtures');
  const [survivingEvent] = await scene.as('boris', (tx) =>
    tx
      .insert(objectEvents)
      .values({
        ...place,
        parentId: survivor.id,
        authorId: author.id,
        title: 'Остающееся событие',
        originSpaceId: survivor.spaceId,
        originSpaceKind: 'personal',
      })
      .returning(),
  );
  if (!survivingEvent) throw new Error('Missing surviving event');
  for (const [table, id] of [
    ['objects', object.id],
    ['object_fields', field.id],
    ['object_events', manual.id],
  ] as const)
    await scene.as('boris', (tx) =>
      tx.insert(recordLinks).values({
        leftTable: table,
        leftId: id,
        rightTable: 'notes',
        rightId: note.id,
        authorId: author.id,
      }),
    );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, object.id)),
  );
  await db.admin.query(
    'ALTER TABLE objects DISABLE TRIGGER objects_trash_time; ALTER TABLE object_fields DISABLE TRIGGER object_fields_trash_time; ALTER TABLE object_events DISABLE TRIGGER object_events_trash_time',
  );
  await db.admin.query("UPDATE objects SET deleted_at=now()-interval '31 days' WHERE id=$1", [
    object.id,
  ]);
  await db.admin.query(
    "UPDATE object_fields SET deleted_at=now()-interval '31 days' WHERE parent_id=$1",
    [object.id],
  );
  await db.admin.query(
    "UPDATE object_events SET deleted_at=now()-interval '31 days' WHERE parent_id=$1",
    [object.id],
  );
  await db.admin.query(
    'ALTER TABLE objects ENABLE TRIGGER objects_trash_time; ALTER TABLE object_fields ENABLE TRIGGER object_fields_trash_time; ALTER TABLE object_events ENABLE TRIGGER object_events_trash_time',
  );
  await createWorkerDatabase(db.worker).delete(objects).where(eq(objects.id, object.id));
  expect((await db.admin.query('SELECT count(*)::int n FROM record_links')).rows[0].n).toBe(0);
  expect(
    await scene.as('boris', (tx) => tx.select().from(notes).where(eq(notes.id, note.id))),
  ).toHaveLength(1);
  expect(
    await scene.as('boris', (tx) =>
      tx.select().from(objectEvents).where(eq(objectEvents.id, survivingEvent.id)),
    ),
  ).toMatchObject([{ deletedAt: null, parentId: survivor.id }]);
});
