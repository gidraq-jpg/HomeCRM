// Обновление R0.5a на базе R0.9a: существующее содержимое и история сохраняются.
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase;
let scene: Scene;
let folder: string;
let before: unknown;
const ids: { table: string; metadata: string; content: string }[] = [];
const snapshot = async () =>
  (
    await db.admin.query(`SELECT * FROM (
  SELECT 'notes' source, to_jsonb(r)-'has_other_contributions' value FROM notes r
  UNION ALL SELECT 'tasks',to_jsonb(r)-ARRAY['has_other_contributions','description','plan_on','plan_time','due_on','due_time','status','checklist','waiting_contact_id','waiting_account_id','check_on','household_id','repeat_rule','overdue_policy','series_id','series_trash_key','repeat_template','repeat_processed_on','predecessor_id','completion_event_id','completion_previous_status','completion_undone_at','is_main','radar_occurrence_id'] FROM tasks r
  UNION ALL SELECT 'shopping',to_jsonb(r)-'has_other_contributions' FROM shopping_items r
  UNION ALL SELECT 'notes_history',to_jsonb(r) FROM notes_history r
  UNION ALL SELECT 'tasks_history',to_jsonb(r) FROM tasks_history r
  UNION ALL SELECT 'shopping_history',to_jsonb(r) FROM shopping_items_history r
) data ORDER BY source,value::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-files-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 16);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  for (const table of ['tasks', 'shopping_items']) {
    const rows = await db.admin.query(
      `INSERT INTO ${table}(space_id,space_kind,audience,author_id,title) VALUES ($1,'household','household',$2,'Вымышленное содержимое'),($1,'household','household',$2,'Вымышленная запись') RETURNING id`,
      [scene.home('household').spaceId, scene.person('boris').id],
    );
    const metadata = rows.rows[0].id;
    const content = rows.rows[1].id;
    await scene.as('anna', (tx) =>
      tx.execute(sql.raw(`UPDATE ${table} SET audience='adults' WHERE id='${metadata}'`)),
    );
    await scene.as('anna', (tx) =>
      tx.execute(sql.raw(`UPDATE ${table} SET title='Настоящий вклад' WHERE id='${content}'`)),
    );
    ids.push({ table, metadata, content });
  }
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('содержимое, даты, аудитория, ответственные и история не меняются', async () => {
  expect(await snapshot()).toEqual(before);
});
