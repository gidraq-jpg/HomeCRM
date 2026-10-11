import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string;
async function snapshot() {
  return (
    await db.admin.query(`SELECT * FROM (SELECT 'tasks' AS source,to_jsonb(t) AS data FROM tasks t
    UNION ALL SELECT 'history',to_jsonb(h) FROM tasks_history h
    UNION ALL SELECT 'deadlines',to_jsonb(d) FROM deadlines d
    UNION ALL SELECT 'notifications',to_jsonb(n) FROM deadline_notifications n) records ORDER BY source,data::text`)
  ).rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-undo-codes-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 59);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  const id = (
    await db.admin.query(
      `INSERT INTO tasks(space_id,space_kind,author_id,assignee_id,title,household_id,plan_on,repeat_rule)
    VALUES($1,'personal',$2,$2,'Прежнее дело',$3,'2030-01-02','{"kind":"daily"}') RETURNING id`,
      [
        scene.person('boris').personalSpaceId,
        scene.person('boris').id,
        scene.home('household').spaceId,
      ],
    )
  ).rows[0]?.id;
  await db.admin.query("UPDATE tasks SET status='done' WHERE id=$1", [id]);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('A3: 0059 → 0060 сохраняет строки, историю, связь преемника, сроки, очередь, RLS и права функции', async () => {
  const before = await snapshot();
  const permissions = async () =>
    (
      await db.admin.query(
        "SELECT proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid='app.task_undo_next()'::regprocedure",
      )
    ).rows;
  const grants = await permissions();
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  expect(await permissions()).toEqual(grants);
  const tables = (
    await db.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('tasks','tasks_history','task_files','deadlines','deadline_notifications')",
    )
  ).rows;
  expect(tables).toHaveLength(5);
  expect(tables.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  const definition = (
    await db.admin.query("SELECT pg_get_functiondef('app.task_undo_next()'::regprocedure) AS body")
  ).rows[0]?.body;
  for (const code of ['task_undo_expired', 'task_completion_changed', 'task_next_task_changed'])
    expect(definition).toContain(code);
  expect(definition).toContain('OLD.repeat_next_event_id=OLD.completion_event_id');
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
});
