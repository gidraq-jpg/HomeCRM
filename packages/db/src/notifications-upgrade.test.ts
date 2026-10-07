import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, before: unknown, id: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-notifications-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 23);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  id = await addNote(db.admin, {
    author: scene.person('boris'),
    placement: scene.personal('boris'),
    title: 'Существующая заметка',
  });
  before = (await db.admin.query('SELECT to_jsonb(n) value FROM notes n WHERE id=$1', [id])).rows;
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('обновление с R0.8 не меняет существующие записи и включено FORCE RLS всех таблиц', async () => {
  expect(
    (await db.admin.query('SELECT to_jsonb(n) value FROM notes n WHERE id=$1', [id])).rows,
  ).toEqual(before);
  const rows = (
    await db.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('push_subscriptions','notification_settings','push_deliveries','push_attempts')",
    )
  ).rows;
  expect(rows).toHaveLength(4);
  expect(rows.every((x) => x.relrowsecurity && x.relforcerowsecurity)).toBe(true);
  await runMigrations(db.owner);
  expect(
    (await db.admin.query('SELECT to_jsonb(n) value FROM notes n WHERE id=$1', [id])).rows,
  ).toEqual(before);
});
