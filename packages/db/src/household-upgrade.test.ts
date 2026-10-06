import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { noteItems, notes } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase;
let scene: Scene;
let folder: string;
let metadata: string;
let text: string;
let itemMetadata: string;
let itemContent: string;
let movedFrom: string;
let movedTo: string;
let original: unknown;
const snapshot = async () =>
  (
    await db.admin.query(`
  SELECT * FROM (
    SELECT 'notes' AS source, to_jsonb(r) - 'has_other_contributions' AS value FROM notes r
    UNION ALL SELECT 'items', to_jsonb(r) - 'has_other_contributions' FROM note_items r
    UNION ALL SELECT 'history', to_jsonb(r) FROM notes_history r
    UNION ALL SELECT 'item-history', to_jsonb(r) FROM note_items_history r
  ) data ORDER BY source, value::text
`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-household-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 6);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  const make = () =>
    addNote(db.admin, { author: scene.person('boris'), placement: scene.home('household') });
  metadata = await make();
  text = await make();
  itemMetadata = await make();
  itemContent = await make();
  movedFrom = await make();
  movedTo = await make();
  const [moved] = await scene.as('boris', (tx) =>
    tx
      .insert(noteItems)
      .values({
        parentId: movedFrom,
        spaceId: scene.home('household').spaceId,
        spaceKind: 'household',
        audience: 'household',
        authorId: scene.person('boris').id,
        title: 'Пункт с историей родителей',
      })
      .returning(),
  );
  if (!moved) throw new Error('No moved item');
  await scene.as('anna', (tx) =>
    tx.update(noteItems).set({ done: true }).where(eq(noteItems.id, moved.id)),
  );
  await scene.as('boris', (tx) =>
    tx.update(noteItems).set({ parentId: movedTo }).where(eq(noteItems.id, moved.id)),
  );
  await scene.as('anna', (tx) =>
    tx.update(notes).set({ pinned: true }).where(eq(notes.id, metadata)),
  );
  await scene.as('anna', (tx) =>
    tx.update(notes).set({ body: 'Настоящий вымышленный вклад' }).where(eq(notes.id, text)),
  );
  for (const id of [itemMetadata, itemContent]) {
    const [item] = await scene.as('boris', (tx) =>
      tx
        .insert(noteItems)
        .values({
          parentId: id,
          spaceId: scene.home('household').spaceId,
          spaceKind: 'household',
          audience: 'household',
          authorId: scene.person('boris').id,
          title: 'Пункт автора',
        })
        .returning(),
    );
    if (!item) throw new Error('No item');
    if (id === itemMetadata) {
      await scene.as('anna', (tx) =>
        tx.update(noteItems).set({ deletedAt: new Date() }).where(eq(noteItems.id, item.id)),
      );
      await scene.as('anna', (tx) =>
        tx.update(noteItems).set({ deletedAt: null }).where(eq(noteItems.id, item.id)),
      );
    } else
      await scene.as('anna', (tx) =>
        tx.update(noteItems).set({ done: true }).where(eq(noteItems.id, item.id)),
      );
  }
  expect(
    (
      await db.admin.query('SELECT has_other_contributions FROM notes WHERE id = ANY($1)', [
        [metadata, text, itemMetadata, itemContent, movedFrom],
      ])
    ).rows.every((r) => r.has_other_contributions),
  ).toBe(true);
  original = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});

it('пересчёт по истории убирает вклад метаданных, сохраняет текст и пункты без изменения данных и истории', async () => {
  expect(await snapshot()).toEqual(original);
  const rows = (await db.admin.query('SELECT id, has_other_contributions FROM notes')).rows;
  const flags = new Map(rows.map((r) => [r.id, r.has_other_contributions]));
  expect(flags.get(metadata)).toBe(false);
  expect(flags.get(itemMetadata)).toBe(false);
  expect(flags.get(text)).toBe(true);
  expect(flags.get(itemContent)).toBe(true);
  expect(flags.get(movedFrom)).toBe(true);
  expect(flags.get(movedTo)).toBe(true);
  const counts = (
    await db.admin.query(`SELECT
    (SELECT count(*)::int FROM household_access) AS members,
    (SELECT count(*)::int FROM space_members WHERE left_at IS NULL) AS active,
    (SELECT count(*)::int FROM member_profiles) AS profiles,
    (SELECT count(*)::int FROM accounts) AS accounts`)
  ).rows[0];
  expect(counts.members).toBe(counts.active);
  expect(counts.profiles).toBe(counts.accounts);
});
