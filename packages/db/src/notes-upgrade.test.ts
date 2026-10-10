// Обновление настоящей схемы R0.2 с вымышленными данными, а не только пустой базы.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, type Scene } from './testing/helpers.ts';
import { isDenied } from './testing/matrix.ts';

let database: TestDatabase;
let scene: Scene;
let legacyFolder: string;
let commonId: string;
let checklistId: string;
let beforeRecords: unknown;
let beforeHistory: unknown;
const tables = ['notes', 'note_items', 'shopping_items', 'tasks'] as const;

const snapshot = async (history = false) =>
  (
    await database.admin.query(
      `SELECT * FROM (${tables
        .map((name) => {
          const table = history ? `${name}_history` : name;
          return `SELECT '${table}' AS source, to_jsonb(r) - ARRAY['has_other_contributions', 'pinned', 'search_text', 'position','description','plan_on','plan_time','due_on','due_time','status','checklist','waiting_contact_id','waiting_account_id','check_on','household_id'] AS record FROM ${table} r`;
        })
        .join(' UNION ALL ')}) records ORDER BY source, record::text`,
    )
  ).rows;

beforeAll(async () => {
  legacyFolder = await mkdtemp(join(tmpdir(), 'homecrm-notes-upgrade-'));
  await mkdir(join(legacyFolder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 4);
  await writeFile(join(legacyFolder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  await Promise.all(
    journal.entries.map((entry: { tag: string }) =>
      copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(legacyFolder, `${entry.tag}.sql`)),
    ),
  );
  database = await createTestDatabase(inject('pgAdminUrl'), legacyFolder);
  scene = await createScene(database);
  const boris = scene.person('boris');
  const anna = scene.person('anna');
  const personal = await addNote(database.admin, {
    author: boris,
    placement: scene.personal('boris'),
    title: 'Старая личная заметка',
  });
  await database.admin.query('UPDATE notes SET body = $1 WHERE id = $2', [
    '**Существующий Markdown**',
    personal,
  ]);
  await database.admin.query(
    `INSERT INTO note_items (parent_id, space_id, space_kind, author_id, title, done, deleted_at)
     VALUES ($1, $2, 'personal', $3, 'Старый пункт в корзине', true, now() - interval '7 days')`,
    [personal, boris.personalSpaceId, boris.id],
  );
  await addNote(database.admin, {
    author: boris,
    placement: scene.personal('boris'),
    trashedDaysAgo: 12,
  });
  commonId = await addNote(database.admin, { author: boris, placement: scene.home('household') });
  await scene.as('anna', (tx) =>
    tx.execute(sql`UPDATE notes SET body = 'Старый чужой вклад' WHERE id = ${commonId}`),
  );
  checklistId = await addNote(database.admin, {
    author: boris,
    placement: scene.home('household'),
  });
  await database.admin.query(
    `INSERT INTO note_items (parent_id, space_id, space_kind, audience, author_id, title, deleted_at)
     VALUES ($1, $2, 'household', 'household', $3, 'Старый чужой пункт', now() - interval '2 days')`,
    [checklistId, scene.home('household').spaceId, anna.id],
  );
  for (const table of ['shopping_items', 'tasks']) {
    await database.admin.query(
      `INSERT INTO ${table} (space_id, space_kind, author_id, title)
       VALUES ($1, 'personal', $2, 'Старая личная запись')`,
      [boris.personalSpaceId, boris.id],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `INSERT INTO ${table} (space_id, space_kind, audience, author_id, title)
       VALUES ($1, 'household', 'household', $2, 'Старая общая запись') RETURNING id`,
      [scene.home('household').spaceId, boris.id],
    );
    await scene.as('anna', (tx) =>
      tx.execute(
        sql.raw(`UPDATE ${table} SET title = 'Старая чужая правка' WHERE id = '${rows[0]?.id}'`),
      ),
    );
  }
  beforeRecords = await snapshot();
  beforeHistory = await snapshot(true);
  await runMigrations(database.owner);
});

afterAll(async () => {
  await database?.drop();
  if (legacyFolder) await rm(legacyFolder, { recursive: true, force: true });
});

it('миграция сохраняет содержимое, ответственных, даты корзины и историю всех четырёх таблиц', async () => {
  expect(await snapshot()).toEqual(beforeRecords);
  expect(await snapshot(true)).toEqual(beforeHistory);
  for (const table of tables) {
    const { rows } = await database.admin.query(
      `SELECT assignee_id FROM ${table} WHERE space_kind = 'personal'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.assignee_id === scene.person('boris').id)).toBe(true);
    const catalogue = await database.admin.query(
      `SELECT c.relforcerowsecurity, t.tgenabled FROM pg_class c
       JOIN pg_trigger t ON t.tgrelid = c.oid
       WHERE c.oid = $1::regclass AND NOT t.tgisinternal`,
      [table],
    );
    expect(catalogue.rows.every((row) => row.relforcerowsecurity && row.tgenabled === 'O')).toBe(
      true,
    );
  }
});

it('старые правки и чужой пункт в корзине запрещают сделать общее личным', async () => {
  for (const id of [commonId, checklistId]) {
    const { rows } = await database.admin.query(
      'SELECT has_other_contributions FROM notes WHERE id = $1',
      [id],
    );
    expect(rows[0]?.has_other_contributions).toBe(true);
    await expect(
      scene.as('boris', (tx) =>
        tx.execute(sql`UPDATE notes SET space_id = ${scene.person('boris').personalSpaceId},
          space_kind = 'personal', audience = NULL WHERE id = ${id}`),
      ),
    ).rejects.toSatisfy(isDenied);
  }
  for (const table of ['shopping_items', 'tasks']) {
    const { rows } = await database.admin.query(
      `SELECT has_other_contributions FROM ${table} WHERE space_kind = 'household'`,
    );
    expect(rows[0]?.has_other_contributions).toBe(true);
  }
});
