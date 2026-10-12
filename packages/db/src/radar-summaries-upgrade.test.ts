import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string, before: unknown;
const family = buildFamily();
async function snapshot() {
  return (
    await db.admin.query(`SELECT * FROM (
  SELECT 'notes' AS tbl,to_jsonb(n) AS data FROM notes n
  UNION ALL SELECT 'history',to_jsonb(h) FROM notes_history h
  UNION ALL SELECT 'deadlines',to_jsonb(d) FROM deadlines d
  UNION ALL SELECT 'occurrences',to_jsonb(o) FROM deadline_occurrences o
  UNION ALL SELECT 'notifications',to_jsonb(n)-'summary_id' FROM deadline_notifications n
  ) x ORDER BY tbl,data::text`)
  ).rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-radar-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 60);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  const boris = family.person('boris'),
    anna = family.person('anna'),
    house = family.houses[0];
  if (!house) throw new Error('Missing test house');
  await createAppDatabase(db.app).withAccount(boris.id, async (tx) => {
    const note = (
      await tx.execute<{ id: string }>(
        sql`INSERT INTO notes(space_id,space_kind,author_id,title) VALUES(${boris.personalSpaceId}::uuid,'personal',${boris.id}::uuid,'Прежняя вымышленная заметка') RETURNING id`,
      )
    ).rows[0];
    if (!note) throw new Error('Missing test note');
    await tx.execute(
      sql`UPDATE notes SET title='Изменённая вымышленная заметка' WHERE id=${note.id}::uuid`,
    );
    await tx.execute(
      sql`INSERT INTO deadlines(note_id,household_id,rule,space_id,space_kind,author_id,assignee_id) VALUES(${note.id}::uuid,${house.id}::uuid,'{"kind":"date","date":"2026-10-10"}',${boris.personalSpaceId}::uuid,'personal',${boris.id}::uuid,${boris.id}::uuid)`,
    );
    await tx.execute(
      sql`INSERT INTO notification_settings(account_id,enabled_kinds,daily_budget,hide_text) VALUES(${boris.id}::uuid,'["deadline","payment_due"]',2,false)`,
    );
  });
  await createAppDatabase(db.app).withAccount(anna.id, (tx) =>
    tx.execute(
      sql`INSERT INTO notification_settings(account_id,enabled_kinds,daily_budget) VALUES(${anna.id}::uuid,'[]',0)`,
    ),
  );
  await db.worker.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id,completed_at) SELECT id,'2026-10-10','2026-10-09T19:00Z','2026-10-10T18:59:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,author_id,assignee_id,now() FROM deadlines`,
  );
  await db.worker.query(
    "INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at,status) SELECT id,assignee_id,starts_at,'summary' FROM deadline_occurrences",
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0060 → новые миграции: записи, история, UUID/отметки наступлений и старые summary сохранены', async () => {
  expect(await snapshot()).toEqual(before);
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  const rows = (
    await db.admin.query(
      'SELECT account_id,enabled_kinds,morning_enabled,weekly_enabled,daily_budget,hide_text FROM notification_settings ORDER BY account_id',
    )
  ).rows;
  expect(rows.find((r) => r.account_id === family.person('anna').id)).toMatchObject({
    enabled_kinds: [],
    morning_enabled: false,
    weekly_enabled: false,
    daily_budget: 0,
  });
  expect(rows.find((r) => r.account_id === family.person('boris').id)).toMatchObject({
    enabled_kinds: [
      'deadline',
      'payment_due',
      'document',
      'task_reminder',
      'task_assignment',
      'task_done',
    ],
    daily_budget: 2,
    hide_text: false,
  });
  expect(
    (
      await createAppDatabase(db.app).withAccount(family.person('anna').id, (tx) =>
        tx.execute(sql`SELECT id FROM notes`),
      )
    ).rowCount,
  ).toBe(0);
  await expect(db.worker.query('SELECT title FROM notes')).rejects.toThrow();
});
