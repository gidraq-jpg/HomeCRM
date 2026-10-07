// R0.5d обновляет заполненную базу после 0018, не переписывая данные и историю.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, objectEvents, objects, RECORD_DEFINITIONS, recordLinks, sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase, scene: Scene, folder: string;
let before: unknown;
let parentId: string, hiddenId: string, independentId: string, unrelatedId: string;
const snapshot = async () =>
  (
    await db.admin.query(`SELECT source,value FROM (
  SELECT 'objects' source,to_jsonb(r) value FROM objects r
  UNION ALL SELECT 'events',to_jsonb(r) FROM object_events r
  UNION ALL SELECT 'objects_history',to_jsonb(r) FROM objects_history r
  UNION ALL SELECT 'events_history',to_jsonb(r) FROM object_events_history r
  UNION ALL SELECT 'fields',to_jsonb(r) FROM object_fields r
  UNION ALL SELECT 'files',to_jsonb(r) FROM object_files r
  UNION ALL SELECT 'links',to_jsonb(r) FROM record_links r
  UNION ALL SELECT 'blobs',to_jsonb(r) FROM file_blobs r
) data ORDER BY source,value::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-objects-api-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 18);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  const parent = await scene.as('boris', async (tx) => {
    const [row] = await tx
      .insert(objects)
      .values({
        ...placementColumns(scene.personal('boris')),
        title: 'До миграции',
        authorId: scene.person('boris').id,
      })
      .returning();
    if (!row) throw Error('parent');
    return row;
  });
  parentId = parent.id;
  const hidden = await scene.as('boris', async (tx) => {
    const [row] = await tx
      .insert(objectEvents)
      .values({
        ...placementColumns(scene.personal('boris')),
        parentId,
        title: 'Личное событие',
        authorId: scene.person('boris').id,
        originSpaceId: parent.spaceId,
        originSpaceKind: 'personal',
      })
      .returning();
    if (!row) throw Error('hidden');
    return row;
  });
  hiddenId = hidden.id;
  await scene.as('boris', (tx) =>
    tx
      .update(objects)
      .set(placementColumns(scene.home('household')))
      .where(eq(objects.id, parentId)),
  );
  const independent = await scene.as('anna', async (tx) => {
    const [row] = await tx
      .insert(objectEvents)
      .values({
        ...placementColumns(scene.home('household')),
        parentId,
        title: 'Отдельная корзина',
        authorId: scene.person('anna').id,
        originSpaceId: scene.home('household').spaceId,
        originSpaceKind: 'household',
      })
      .returning();
    if (!row) throw Error('independent');
    return row;
  });
  independentId = independent.id;
  await scene.as('anna', (tx) =>
    tx
      .update(objectEvents)
      .set({ deletedAt: new Date() })
      .where(eq(objectEvents.id, independentId)),
  );
  const [unrelated] = await db.admin
    .query(
      `INSERT INTO objects(space_id,space_kind,audience,author_id,title) VALUES ($1,'household','household',$2,'Другой объект') RETURNING id`,
      [scene.home('household').spaceId, scene.person('anna').id],
    )
    .then((result) => result.rows);
  unrelatedId = unrelated.id;
  await db.admin.query(
    `INSERT INTO object_events(space_id,space_kind,audience,author_id,title,parent_id,origin_space_id,origin_space_kind) VALUES ($1,'household','household',$2,'Постороннее событие',$3,$1,'household')`,
    [scene.home('household').spaceId, scene.person('anna').id, unrelatedId],
  );
  // Дополнительно сохраняем существующие метаданные файлов, блоки и ссылки.
  await db.admin.query(
    `INSERT INTO object_files(space_id,space_kind,audience,author_id,title,parent_id,mime_type,size_bytes,storage_key,envelope) VALUES ($1,'household','household',$2,'Вымышленный.pdf',$3,'application/pdf',32,gen_random_uuid(),'{}')`,
    [scene.home('household').spaceId, scene.person('anna').id, parentId],
  );
  await scene.as('anna', (tx) =>
    tx.insert(recordLinks).values({
      leftTable: 'objects',
      leftId: parentId,
      rightTable: 'objects',
      rightId: unrelatedId,
      authorId: scene.person('anna').id,
    }),
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0019 сохраняет строки, ссылки, файлы, даты и историю существующей базы', async () => {
  expect(await snapshot()).toEqual(before);
});
it('каскад изменяет только события текущего родителя, включая скрытые снимком происхождения', async () => {
  const unrelated = (
    await db.admin.query('SELECT * FROM object_events WHERE parent_id=$1', [unrelatedId])
  ).rows;
  const invisible = () =>
    scene.as('anna', (tx) => tx.select().from(objectEvents).where(eq(objectEvents.id, hiddenId)));
  expect(await invisible()).toEqual([]);
  await scene.as('anna', async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.object_cascade_id',${parentId},true),set_config('app.object_cascade_mode','place',true)`,
    );
    expect(await tx.select().from(objectEvents).where(eq(objectEvents.id, hiddenId))).toEqual([]);
  });
  await scene.as('anna', (tx) =>
    tx.update(objects).set({ audience: 'adults' }).where(eq(objects.id, parentId)),
  );
  expect(
    (await db.admin.query('SELECT audience FROM object_events WHERE id=$1', [hiddenId])).rows[0]
      .audience,
  ).toBe('adults');
  await scene.as('anna', (tx) =>
    tx.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, parentId)),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM object_events WHERE id=$1', [hiddenId])).rows[0]
      .deleted_at,
  ).not.toBeNull();
  await scene.as('anna', (tx) =>
    tx.update(objects).set({ deletedAt: null }).where(eq(objects.id, parentId)),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM object_events WHERE id=$1', [hiddenId])).rows[0]
      .deleted_at,
  ).toBeNull();
  expect(
    (await db.admin.query('SELECT deleted_at FROM object_events WHERE id=$1', [independentId]))
      .rows[0].deleted_at,
  ).not.toBeNull();
  expect(
    (await db.admin.query('SELECT * FROM object_events WHERE parent_id=$1', [unrelatedId])).rows,
  ).toEqual(unrelated);
  expect(await invisible()).toEqual([]);
  const source = (
    await db.admin.query(
      "SELECT pg_get_functiondef('app.cascade_object_events()'::regprocedure) source",
    )
  ).rows[0].source as string;
  const updates = source.match(/UPDATE public\.object_events[^;]+;/g) ?? [];
  expect(updates).toHaveLength(3);
  for (const update of updates) expect(update).toMatch(/WHERE parent_id=NEW.id/);
});
it('после обновления NULL ответственного общего объекта заменяется автором в базе', async () => {
  const [updated] = await scene.as('anna', (tx) =>
    tx.update(objects).set({ assigneeId: null }).where(eq(objects.id, unrelatedId)).returning(),
  );
  expect(updated?.assigneeId).toBe(scene.person('anna').id);
});
it('record_guard закрыт для незарегистрированной таблицы; перечень покрывает все виды записей', async () => {
  const source = (
    await db.admin.query("SELECT pg_get_functiondef('app.record_guard()'::regprocedure) source")
  ).rows[0].source as string;
  const listed = source
    .match(/TG_TABLE_NAME NOT IN \(([^)]+)\)/)?.[1]
    ?.match(/'[^']+'/g)
    ?.map((value) => value.slice(1, -1));
  expect(listed?.sort()).toEqual(RECORD_DEFINITIONS.map((value) => value.name).sort());
  await db.admin.query('CREATE TABLE unregistered_records (LIKE objects INCLUDING DEFAULTS)');
  await db.admin.query('INSERT INTO unregistered_records SELECT * FROM objects LIMIT 1');
  await db.admin.query(
    "CREATE TRIGGER unregistered_guard BEFORE UPDATE ON unregistered_records FOR EACH ROW EXECUTE FUNCTION app.record_guard('root')",
  );
  await expect(
    db.admin.query("UPDATE unregistered_records SET title='Непроверенный вклад'"),
  ).rejects.toMatchObject({ code: '23514' });
});
