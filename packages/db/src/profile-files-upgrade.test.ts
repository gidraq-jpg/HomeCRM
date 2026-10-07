// Миграция со старой ссылки не открывает личные вложения семье и сохраняет сами файлы.

import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, memberProfiles, noteFiles, notes, objectFiles, objects } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase, scene: Scene, folder: string;
let before: unknown;
const snapshot = async () =>
  (
    await db.admin.query(`SELECT source,value FROM (
  SELECT 'notes' source,to_jsonb(r) value FROM notes r
  UNION ALL SELECT 'objects',to_jsonb(r) FROM objects r
  UNION ALL SELECT 'note_files',to_jsonb(r) FROM note_files r
  UNION ALL SELECT 'object_files',to_jsonb(r) FROM object_files r
  UNION ALL SELECT 'note_history',to_jsonb(r) FROM note_files_history r
  UNION ALL SELECT 'object_history',to_jsonb(r) FROM object_files_history r
  UNION ALL SELECT 'blobs',to_jsonb(r) FROM file_blobs r
) data ORDER BY source,value::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-profile-files-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 19);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  for (const [who, parentTable, table] of [
    ['boris', notes, noteFiles],
    ['anna', objects, objectFiles],
  ] as const) {
    await scene.as(who, async (tx) => {
      const [parent] = await tx
        .insert(parentTable)
        .values({
          ...placementColumns(scene.personal(who)),
          authorId: scene.person(who).id,
          title: 'Личная карточка',
        })
        .returning();
      if (!parent) throw new Error('Parent missing');
      const [file] = await tx
        .insert(table)
        .values({
          sizeBytes: 32,
          storageKey: randomUUID(),
          envelope: {},
          ...placementColumns(scene.personal(who)),
          parentId: parent.id,
          authorId: scene.person(who).id,
          title: 'Личное фото',
          mimeType: 'image/jpeg',
        })
        .returning();
      if (!file) throw new Error('File missing');
      await tx
        .update(memberProfiles)
        .set({ photoFileId: file.id })
        .where(eq(memberProfiles.accountId, scene.person(who).id));
    });
  }
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0020–0021 сохраняют вложения, блоки, даты и историю; снимают только старые привязки профиля', async () => {
  expect(await snapshot()).toEqual(before);
  expect(
    (
      await db.admin.query(
        'SELECT photo_file_id FROM member_profiles WHERE photo_file_id IS NOT NULL',
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await db.admin.query(
        `SELECT relforcerowsecurity FROM pg_class WHERE oid='member_profiles'::regclass`,
      )
    ).rows[0].relforcerowsecurity,
  ).toBe(true);
  expect((await db.owner.query('SELECT * FROM member_profiles')).rows).toEqual([]);
});
