import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, noteFiles, notes, objectFiles, objects, sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { fileFixture, placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
afterAll(async () => {
  await db?.drop();
});
it.each(['note', 'object'] as const)(
  '%s: отсутствующий/скрытый родитель не раскрываются SQLSTATE, FK места и аудитории отложены',
  async (type) => {
    const parentTable = type === 'note' ? notes : objects;
    const table = type === 'note' ? noteFiles : objectFiles;
    const fileType = type === 'note' ? 'note_file' : 'object_file';
    const [parent] = await scene.as('boris', (tx) =>
      tx
        .insert(parentTable)
        .values({
          ...placementColumns(scene.personal('boris')),
          authorId: scene.person('boris').id,
          title: 'Вымышленное личное',
        })
        .returning(),
    );
    if (!parent) throw new Error('parent');
    for (const parentId of [parent.id, randomUUID()]) {
      const error = await scene
        .as('anna', (tx) =>
          tx.insert(table).values({
            ...fileFixture(fileType),
            ...placementColumns(scene.personal('anna')),
            parentId,
            authorId: scene.person('anna').id,
            title: 'Файл',
          } as never),
        )
        .catch((error) => error);
      expect(hasCode(error, ['42501'])).toBe(true);
      expect(hasCode(error, ['23503'])).toBe(false);
    }
    // Видимый родитель, но неверное место: отложенный FK отказывает и в COMMIT.
    const mismatch = await scene
      .as('boris', (tx) =>
        tx.insert(table).values({
          ...fileFixture(fileType),
          ...placementColumns(scene.home('household')),
          parentId: parent.id,
          authorId: scene.person('boris').id,
          title: 'Файл',
        } as never),
      )
      .catch((error) => error);
    expect(hasCode(mismatch, ['23503'])).toBe(true);
    const [file] = await scene.as('boris', (tx) =>
      tx
        .insert(table)
        .values({
          ...fileFixture(fileType),
          ...placementColumns(scene.personal('boris')),
          parentId: parent.id,
          authorId: scene.person('boris').id,
          title: 'Файл',
        } as never)
        .returning(),
    );
    if (!file) throw new Error('file');
    for (const fields of [
      { storageKey: randomUUID() },
      { envelope: {} },
      { parentId: randomUUID() },
    ]) {
      if ('envelope' in fields) fields.envelope = { changed: true };
      const error = await scene
        .as('boris', (tx) => tx.update(table).set(fields).where(eq(table.id, file.id)))
        .catch((error) => error);
      expect(hasCode(error, ['42501'])).toBe(true);
    }
    const history = await db.admin.query(
      `SELECT changes::text AS value FROM ${type === 'note' ? 'note_files' : 'object_files'}_history`,
    );
    expect(history.rows.every((row) => !/(storage_key|envelope)/.test(row.value))).toBe(true);
  },
);
it('реестр блоков не читает и не меняет приложение напрямую; служба входа не читает его', async () => {
  expect(
    (await scene.as('boris', (tx) => tx.execute(sql`SELECT key FROM file_blobs`))).rowCount,
  ).toBe(0);
  const key = randomUUID();
  const inserted = await scene
    .as('boris', (tx) => tx.execute(sql`INSERT INTO file_blobs(key) VALUES (${key})`))
    .catch((error) => error);
  expect(hasCode(inserted, ['42501'])).toBe(true);
  await expect(db.auth.query('SELECT key FROM file_blobs')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    db.worker.query('INSERT INTO file_blobs(key) VALUES ($1)', [key]),
  ).rejects.toMatchObject({ code: '42501' });
});
