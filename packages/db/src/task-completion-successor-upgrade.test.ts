import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let scene: Scene;
let db: TestDatabase, folder: string, before: Record<string, unknown>[];
const cases: { id: string; first: string; expected: string | null | 'unknown' }[] = [];
async function snapshot() {
  return (
    await db.admin.query(`SELECT * FROM (
    SELECT 'tasks' AS source,to_jsonb(t)-'repeat_next_event_id' AS data FROM tasks t
    UNION ALL SELECT 'history',to_jsonb(h) FROM tasks_history h
    UNION ALL SELECT 'deadlines',to_jsonb(d) FROM deadlines d
    UNION ALL SELECT 'notifications',to_jsonb(n) FROM deadline_notifications n
  ) records ORDER BY source,data::text`)
  ).rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-successor-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 58);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  scene = await createScene(db);
  for (const state of ['done', 'resumed', 'recompleted', 'undone', 'missing_history']) {
    const id = (
      await db.admin.query(
        `INSERT INTO tasks(space_id,space_kind,author_id,assignee_id,title,household_id,plan_on,repeat_rule)
      VALUES($1,'personal',$2,$2,'Прежний повтор',$3,'2026-10-10','{"kind":"daily"}') RETURNING id`,
        [
          scene.person('boris').personalSpaceId,
          scene.person('boris').id,
          scene.home('household').spaceId,
        ],
      )
    ).rows[0]?.id;
    const first = (
      await db.admin.query(
        "UPDATE tasks SET status='done' WHERE id=$1 RETURNING completion_event_id",
        [id],
      )
    ).rows[0]?.completion_event_id;
    if (state === 'resumed' || state === 'recompleted') {
      await db.admin.query(
        "UPDATE tasks SET done_at=clock_timestamp()-interval '8 seconds' WHERE id=$1",
        [id],
      );
      await db.admin.query("UPDATE tasks SET status='open',done_at=NULL WHERE id=$1", [id]);
      if (state === 'recompleted')
        await db.admin.query("UPDATE tasks SET status='done' WHERE id=$1", [id]);
    }
    if (state === 'undone')
      await db.admin.query(
        "UPDATE tasks SET status='open',done_at=NULL,completion_undone_at=clock_timestamp() WHERE id=$1",
        [id],
      );
    if (state === 'missing_history')
      await db.admin.query('DELETE FROM tasks_history WHERE record_id=$1', [id]);
    cases.push({
      id,
      first,
      expected: state === 'undone' ? null : state === 'missing_history' ? 'unknown' : first,
    });
  }
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('TASK-7: миграция 0059 связывает преемника с первым событием и сохраняет все прежние поля, историю, сроки и очередь', async () => {
  expect(await snapshot()).toEqual(before);
  for (const fixture of cases) {
    const row = (
      await db.admin.query('SELECT repeat_next_event_id FROM tasks WHERE id=$1', [fixture.id])
    ).rows[0];
    if (fixture.expected === 'unknown') {
      expect(row?.repeat_next_event_id).toBeTruthy();
      expect(row?.repeat_next_event_id).not.toBe(fixture.first);
    } else expect(row?.repeat_next_event_id).toBe(fixture.expected);
  }
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

it('TASK-7: отмена после обновления сохраняет прежнего преемника; личное закрыто другим участникам и worker', async () => {
  const fixture = cases[2];
  if (!fixture) throw new Error('Missing migrated completion');
  const next = (
    await db.admin.query(
      'SELECT to_jsonb(t) AS data FROM tasks t WHERE predecessor_id=$1 AND deleted_at IS NULL',
      [fixture.id],
    )
  ).rows[0]?.data;
  await db.admin.query('UPDATE tasks SET done_at=clock_timestamp() WHERE id=$1', [fixture.id]);
  const result = await scene.as('boris', (tx) =>
    tx.execute<{ repeat_next_event_id: string }>(
      sql`UPDATE tasks SET status='open',done_at=NULL,completion_undone_at=clock_timestamp() WHERE id=${fixture.id}::uuid RETURNING repeat_next_event_id`,
    ),
  );
  expect(result.rows[0]?.repeat_next_event_id).toBe(fixture.first);
  expect(
    (await db.admin.query('SELECT to_jsonb(t) AS data FROM tasks t WHERE id=$1', [next.id])).rows[0]
      ?.data,
  ).toEqual(next);
  for (const who of ['anna', 'vera'] as const)
    expect(
      (
        await scene.as(who, (tx) =>
          tx.execute(
            sql`SELECT repeat_next_event_id FROM tasks WHERE id=${fixture.id}::uuid OR id=${next.id}::uuid`,
          ),
        )
      ).rowCount,
    ).toBe(0);
  await expect(db.worker.query('SELECT repeat_next_event_id FROM tasks')).rejects.toThrow();
  const history = (
    await scene.as('boris', (tx) =>
      tx.execute<{ actor_id: string }>(
        sql`SELECT actor_id FROM tasks_history WHERE record_id=${fixture.id}::uuid AND changes ? 'completion_undone_at' ORDER BY id DESC LIMIT 1`,
      ),
    )
  ).rows;
  expect(history[0]?.actor_id).toBe(scene.person('boris').id);
});
