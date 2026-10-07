import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, before: unknown;
const snapshot = async () =>
  (
    await db.admin.query(
      `SELECT * FROM (SELECT 'note' source,to_jsonb(r) value FROM notes r UNION ALL SELECT 'history',to_jsonb(r) FROM notes_history r) data ORDER BY source,value::text`,
    )
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-search-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 21);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  await addNote(db.admin, {
    author: scene.person('boris'),
    placement: scene.personal('boris'),
    title: 'Старая личная заметка',
  });
  await addNote(db.admin, {
    author: scene.person('anna'),
    placement: scene.home('household'),
    title: 'Старая общая заметка',
  });
  await addNote(db.admin, {
    author: scene.person('anna'),
    placement: scene.home('household'),
    title: 'Старая корзина',
    trashedDaysAgo: 10,
  });
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('непустая база обновляется без изменения источников и истории; живое проиндексировано, корзина исключена', async () => {
  expect(await snapshot()).toEqual(before);
  expect((await db.admin.query('SELECT title FROM search_index ORDER BY title')).rows).toEqual([
    { title: 'Старая личная заметка' },
    { title: 'Старая общая заметка' },
  ]);
  const rows = (
    await db.admin.query(
      `SELECT relname,relforcerowsecurity FROM pg_class WHERE relname IN ('notes','note_items','objects','object_fields','object_events','search_index')`,
    )
  ).rows;
  expect(rows).toHaveLength(6);
  expect(rows.every((r) => r.relforcerowsecurity)).toBe(true);
  expect((await db.owner.query('SELECT * FROM search_index')).rows).toEqual([]);
});
