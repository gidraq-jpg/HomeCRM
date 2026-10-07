// Регрессии блокеров PR #16 на обновлении уже заполненной базы R0.5a.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, notes, objectEvents, objectFields, objects, sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase;
let scene: Scene;
let folder: string;
let before: unknown;
let objectId: string;
let contactId: string;
let manualId: string;
let fieldId: string;
const snapshot = async () =>
  (
    await db.admin.query(`
  SELECT * FROM (
    SELECT 'objects' source,to_jsonb(r) value FROM objects r
    UNION ALL SELECT 'fields',to_jsonb(r) FROM object_fields r
    UNION ALL SELECT 'events',to_jsonb(r) FROM object_events r
    UNION ALL SELECT 'notes',to_jsonb(r) FROM notes r
    UNION ALL SELECT 'objects_history',to_jsonb(r) FROM objects_history r
    UNION ALL SELECT 'fields_history',to_jsonb(r) FROM object_fields_history r
    UNION ALL SELECT 'events_history',to_jsonb(r) FROM object_events_history r
    UNION ALL SELECT 'notes_history',to_jsonb(r) FROM notes_history r
  ) data ORDER BY source,value::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-objects-review-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 14);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  const place = placementColumns(scene.home('household'));
  const [object] = await scene.as('boris', (tx) =>
    tx
      .insert(objects)
      .values({ ...place, authorId: scene.person('boris').id, title: 'Объект до ревью' })
      .returning(),
  );
  const [contact] = await scene.as('anna', (tx) =>
    tx
      .insert(notes)
      .values({ ...place, authorId: scene.person('anna').id, title: 'Контакт до ревью' })
      .returning(),
  );
  if (!object || !contact) throw new Error('Missing upgrade fixtures');
  objectId = object.id;
  contactId = contact.id;
  const [field] = await scene.as('anna', (tx) =>
    tx
      .insert(objectFields)
      .values({
        ...place,
        parentId: objectId,
        authorId: scene.person('anna').id,
        title: 'Чужое поле',
        value: 'Сохранить',
      })
      .returning(),
  );
  const [manual] = await scene.as('anna', (tx) =>
    tx
      .insert(objectEvents)
      .values({
        ...place,
        parentId: objectId,
        authorId: scene.person('anna').id,
        title: 'Событие до ревью',
        contactTable: 'notes',
        contactId,
        originSpaceId: object.spaceId,
        originSpaceKind: 'household',
      })
      .returning(),
  );
  if (!field || !manual) throw new Error('Missing upgrade children');
  fieldId = field.id;
  manualId = manual.id;
  await scene.as('anna', (tx) =>
    tx.update(objectFields).set({ deletedAt: new Date() }).where(eq(objectFields.id, fieldId)),
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('обновление с 0014 сохраняет содержимое, историю, ссылки, даты и доступ', async () => {
  expect(await snapshot()).toEqual(before);
});
it('RLS события следует объекту, а прямой SQL и поддельные контексты не дают служебных прав', async () => {
  await scene.as('anna', (tx) =>
    tx
      .update(notes)
      .set(placementColumns(scene.personal('anna')))
      .where(eq(notes.id, contactId)),
  );
  expect(
    await scene.as('vera', (tx) =>
      tx.select({ id: objectEvents.id }).from(objectEvents).where(eq(objectEvents.id, manualId)),
    ),
  ).toEqual([{ id: manualId }]);
  const deletedAt = (
    await db.admin.query('SELECT deleted_at FROM object_fields WHERE id=$1', [fieldId])
  ).rows[0].deleted_at as Date;
  const rows = await scene.as('boris', async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.parent_restore_id',${objectId},true),set_config('app.parent_restore_table','object_fields',true),set_config('app.parent_restore_time',${deletedAt.toISOString()},true)`,
    );
    return tx
      .update(objectFields)
      .set({ deletedAt: null })
      .where(eq(objectFields.id, fieldId))
      .returning({ id: objectFields.id });
  });
  expect(rows).toEqual([]);
  const worker = await db.worker.connect();
  try {
    await worker.query('BEGIN');
    await worker.query(
      "SELECT set_config('app.contact_purge_table','notes',true),set_config('app.contact_purge_id',$1,true)",
      [contactId],
    );
    expect(
      (
        await worker.query(
          'UPDATE object_events SET contact_id=NULL,contact_table=NULL WHERE id=$1',
          [manualId],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await worker.query('ROLLBACK');
    worker.release();
  }
  expect(
    (await db.admin.query('SELECT contact_id FROM object_events WHERE id=$1', [manualId])).rows[0]
      .contact_id,
  ).toBe(contactId);
});
it('после обновления автор родителя восстанавливает чужое событие; отдельное поле остаётся в корзине', async () => {
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, objectId)),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: null }).where(eq(objects.id, objectId)),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM object_events WHERE id=$1', [manualId])).rows[0]
      .deleted_at,
  ).toBeNull();
  expect(
    (await db.admin.query('SELECT deleted_at FROM object_fields WHERE id=$1', [fieldId])).rows[0]
      .deleted_at,
  ).not.toBeNull();
});
