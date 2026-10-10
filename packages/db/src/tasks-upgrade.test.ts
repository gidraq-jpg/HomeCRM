import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, ids: string[], before: Record<string, unknown>[];
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-tasks-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 53);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db);
  ids = (
    await db.admin.query(
      `INSERT INTO tasks(space_id,space_kind,author_id,title,due_at,done_at,deleted_at) VALUES
    ($1,'personal',$2,'Существующее открытое дело','2026-10-15T13:00Z',NULL,NULL),
    ($1,'personal',$2,'Существующее сделанное дело',NULL,'2026-10-09T13:00Z',NULL),
    ($1,'personal',$2,'Существующее дело в корзине',NULL,NULL,now()-interval '1 day') RETURNING id`,
      [scene.person('boris').personalSpaceId, scene.person('boris').id],
    )
  ).rows.map((r) => r.id);
  before = (
    await db.admin.query(
      'SELECT to_jsonb(t) AS data FROM tasks t WHERE id=ANY($1::uuid[]) ORDER BY id',
      [ids],
    )
  ).rows.map((r) => r.data);
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TASK-1: обновление сохраняет все старые поля, корзину и completed timestamp; done_at → done', async () => {
  const after = (
    await db.admin.query(
      'SELECT to_jsonb(t) AS data FROM tasks t WHERE id=ANY($1::uuid[]) ORDER BY id',
      [ids],
    )
  ).rows.map((r) => r.data);
  for (let i = 0; i < before.length; i++) {
    expect(after[i]).toMatchObject(before[i] ?? {});
    expect(after[i].status).toBe(before[i]?.done_at ? 'done' : 'open');
    expect(after[i].checklist).toEqual([]);
  }
  const flags = await db.admin.query(
    "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('tasks','task_files','task_files_history')",
  );
  expect(flags.rows).toHaveLength(3);
  expect(flags.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
});
it('TASK-1: существующие живые дела индексируются без корзины; постоянных backfill-политик нет', async () => {
  const hits = (
    await db.admin.query(
      "SELECT source_id FROM search_index WHERE source_type='task' ORDER BY source_id",
    )
  ).rows.map((r) => r.source_id);
  expect(hits).toEqual(before.filter((r) => r.deleted_at === null).map((r) => r.id));
  expect(
    (
      await db.admin.query(
        "SELECT policyname FROM pg_policies WHERE policyname IN ('tasks_search_backfill','task_index_backfill')",
      )
    ).rows,
  ).toEqual([]);
});
