import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase, scene: Scene, folder: string, noteId: string, before: unknown;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-deadlines-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 22);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  noteId = await addNote(db.admin, {
    author: scene.person('boris'),
    placement: scene.home('adults'),
    title: 'Существующая вымышленная заметка',
  });
  before = (await db.admin.query('SELECT to_jsonb(n) value FROM notes n WHERE id=$1', [noteId]))
    .rows;
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('обновление сохраняет существующие записи и оставляет пояс до чтения прежней настройки сервера', async () => {
  expect(
    (await db.admin.query('SELECT to_jsonb(n) value FROM notes n WHERE id=$1', [noteId])).rows,
  ).toEqual(before);
  expect(
    (await db.admin.query("SELECT time_zone FROM spaces WHERE kind='household'")).rows.every(
      (x) => x.time_zone === null,
    ),
  ).toBe(true);
  await db.worker.query(
    "UPDATE spaces SET time_zone='Europe/Moscow' WHERE kind='household' AND time_zone IS NULL",
  );
  await db.worker.query(
    "UPDATE spaces SET time_zone='Pacific/Auckland' WHERE kind='household' AND time_zone IS NULL",
  );
  expect(
    (await db.admin.query("SELECT time_zone FROM spaces WHERE kind='household'")).rows.every(
      (x) => x.time_zone === 'Europe/Moscow',
    ),
  ).toBe(true);
});
