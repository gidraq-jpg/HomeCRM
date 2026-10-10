import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { fileFixture } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase, scene: Scene, folder: string, taskId: string, fileIds: string[];
let before: unknown;
const snapshot = async () =>
  (
    await db.admin.query(`SELECT * FROM (
  SELECT 'tasks' AS source,to_jsonb(t)-ARRAY['repeat_rule','overdue_policy','series_id','series_trash_key','repeat_template','repeat_processed_on','predecessor_id','completion_event_id','completion_previous_status','completion_undone_at','is_main','radar_occurrence_id'] AS data FROM tasks t
  UNION ALL SELECT 'files',to_jsonb(f) FROM task_files f
  UNION ALL SELECT 'task_history',to_jsonb(h) FROM tasks_history h
  UNION ALL SELECT 'file_history',to_jsonb(h) FROM task_files_history h
  ) records ORDER BY source,data::text`)
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-task-review-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 55);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  taskId = (
    await db.admin.query(
      "INSERT INTO tasks(space_id,space_kind,audience,author_id,assignee_id,title) VALUES($1,'household','household',$2,$3,'Дело до исправления') RETURNING id",
      [scene.home('household').spaceId, scene.person('boris').id, scene.person('vera').id],
    )
  ).rows[0].id;
  fileIds = [];
  for (const trashed of [false, true]) {
    const fixture = fileFixture('task_file') as { storageKey: string };
    fileIds.push(
      (
        await db.admin.query(
          `INSERT INTO task_files(parent_id,space_id,space_kind,audience,author_id,assignee_id,title,mime_type,size_bytes,storage_key,envelope,deleted_at)
       VALUES($1,$2,'household','household',$3,$3,'Файл до исправления','application/pdf',8,$4,'{}',CASE WHEN $5 THEN now() ELSE NULL END) RETURNING id`,
          [
            taskId,
            scene.home('household').spaceId,
            scene.person('vera').id,
            fixture.storageKey,
            trashed,
          ],
        )
      ).rows[0].id,
    );
  }
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TASK-1: обновление 0055 → 0056 не переписывает дела, файлы, корзину и историю', async () => {
  expect(await snapshot()).toEqual(before);
});
it('TASK-1: каскад атомарен, включает корзину и закрывает файлы ребёнку; прямая правка корзины запрещена', async () => {
  await expect(
    scene.as('anna', (tx) =>
      tx.execute(
        sql`UPDATE task_files SET assignee_id=${scene.person('boris').id}::uuid WHERE id=${fileIds[1]}::uuid`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    scene.as('boris', async (tx) => {
      await tx.execute(
        sql`UPDATE tasks SET assignee_id=${scene.person('boris').id}::uuid,audience='adults' WHERE id=${taskId}::uuid`,
      );
      throw new Error('Rollback fictional transaction');
    }),
  ).rejects.toThrow('Rollback fictional transaction');
  expect(await snapshot()).toEqual(before);
  await scene.as('boris', async (tx) => {
    await tx.execute(
      sql`UPDATE tasks SET assignee_id=${scene.person('boris').id}::uuid WHERE id=${taskId}::uuid`,
    );
    await tx.execute(sql`UPDATE tasks SET audience='adults' WHERE id=${taskId}::uuid`);
  });
  const files = (
    await db.admin.query(
      'SELECT audience,assignee_id,deleted_at FROM task_files WHERE parent_id=$1 ORDER BY deleted_at NULLS FIRST',
      [taskId],
    )
  ).rows;
  expect(files).toHaveLength(2);
  for (const file of files)
    expect(file).toMatchObject({ audience: 'adults', assignee_id: scene.person('boris').id });
  expect(files[0].deleted_at).toBeNull();
  expect(files[1].deleted_at).toBeInstanceOf(Date);
  expect(
    (
      await scene.as('vera', (tx) =>
        tx.execute(sql`SELECT id FROM task_files WHERE parent_id=${taskId}::uuid`),
      )
    ).rows,
  ).toEqual([]);
});
