import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, before: Record<string, unknown>[];
async function snapshot() {
  return (
    await db.admin.query(`SELECT * FROM (
    SELECT 'tasks' AS source,to_jsonb(t) AS data FROM tasks t
    UNION ALL SELECT 'history',to_jsonb(h) FROM tasks_history h
    UNION ALL SELECT 'deadlines',to_jsonb(d) FROM deadlines d
    UNION ALL SELECT 'notifications',to_jsonb(n) FROM deadline_notifications n
  ) records ORDER BY source,data::text`)
  ).rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-repeat-review-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 57);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  const house = scene.home('household').spaceId;
  const rows = await db.admin.query(
    `INSERT INTO tasks(space_id,space_kind,audience,author_id,assignee_id,title,household_id,plan_on,repeat_rule)
    VALUES($1,'household','household',$2,$3,'Прежняя серия',$1,'2026-10-10','{"kind":"daily"}'),
    ($1,'household','household',$2,$2,'Прежнее обычное дело',$1,'2026-10-10',NULL) RETURNING id`,
    [house, scene.person('boris').id, scene.person('anna').id],
  );
  await db.admin.query("UPDATE tasks SET status='done' WHERE id=$1", [rows.rows[0]?.id]);
  await db.admin.query(
    `INSERT INTO tasks(space_id,space_kind,audience,author_id,assignee_id,title,deleted_at)
    VALUES($1,'household','household',$2,$2,'Прежняя корзина',now()-interval '1 day')`,
    [house, scene.person('boris').id],
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TASK-4/7/11: миграция 0058 сохраняет строки, преемника, историю, сроки, очередь и FORCE RLS базы 0057', async () => {
  expect(await snapshot()).toEqual(before);
  const rows = (
    await db.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('tasks','tasks_history','deadline_notifications')",
    )
  ).rows;
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
});
