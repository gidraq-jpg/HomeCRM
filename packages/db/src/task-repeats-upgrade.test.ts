import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, before: Record<string, unknown>[];
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-repeat-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 56);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  await db.admin.query(
    `INSERT INTO tasks(space_id,space_kind,author_id,assignee_id,title,status,done_at,deleted_at) VALUES($1,'personal',$2,$2,'Прежнее открытое дело','open',NULL,NULL),($1,'personal',$2,$2,'Прежнее выполненное дело','done',now()-interval '1 day',NULL),($1,'personal',$2,$2,'Прежняя корзина','open',NULL,now()-interval '1 day')`,
    [scene.person('boris').personalSpaceId, scene.person('boris').id],
  );
  before = (await db.admin.query('SELECT to_jsonb(t) AS data FROM tasks t ORDER BY id')).rows.map(
    (r) => r.data,
  );
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TASK-3: аддитивная миграция сохраняет все прежние поля, даты, UUID и корзину', async () => {
  const after = (
    await db.admin.query('SELECT to_jsonb(t) AS data FROM tasks t ORDER BY id')
  ).rows.map((r) => r.data);
  expect(after).toHaveLength(before.length);
  for (let i = 0; i < before.length; i++) {
    for (const [key, value] of Object.entries(before[i] ?? {}))
      expect(after[i]?.[key], key).toEqual(value);
    expect(after[i]).toMatchObject({
      repeat_rule: null,
      series_id: null,
      completion_event_id: null,
    });
  }
  const state = (
    await db.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('tasks','tasks_history','deadline_notifications')",
    )
  ).rows;
  expect(state.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
});
