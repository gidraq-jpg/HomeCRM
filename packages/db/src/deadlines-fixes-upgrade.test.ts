import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene } from './testing/helpers.ts';

let db: TestDatabase, folder: string, before: unknown;
const tables = [
  'notes',
  'deadlines',
  'deadline_occurrences',
  'deadline_notifications',
  'push_deliveries',
];
async function snapshot() {
  const rows = [];
  for (const table of tables)
    rows.push((await db.admin.query(`SELECT to_jsonb(t) value FROM ${table} t ORDER BY id`)).rows);
  return rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-r08c-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 25);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const scene = await createScene(db),
    boris = scene.person('boris');
  const note = await addNote(db.admin, {
    author: boris,
    placement: scene.personal('boris'),
    title: 'Существующий вымышленный срок',
  });
  const house = [...boris.viewer.memberships.keys()][0];
  await createAppDatabase(db.app).withAccount(boris.id, (tx) =>
    tx.execute(sql`
    INSERT INTO deadlines(note_id,household_id,rule,space_id,space_kind,author_id,assignee_id)
    VALUES(${note},${house},'{"kind":"date","date":"2026-10-10","warnings":[0]}',${boris.personalSpaceId},'personal',${boris.id},${boris.id})`),
  );
  await db.admin.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,completed_at,space_id,space_kind,author_id,assignee_id)
    SELECT id,day::date,day,day,'Asia/Yekaterinburg','[]',day,space_id,space_kind,author_id,assignee_id FROM deadlines CROSS JOIN generate_series('2026-10-10'::timestamptz,'2026-10-11'::timestamptz,interval '1 day') day`);
  await db.worker.query(`INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at,status)
    SELECT id,assignee_id,starts_at,CASE WHEN date='2026-10-10' THEN 'sent' ELSE 'cancelled' END FROM deadline_occurrences`);
  await db.worker.query(`INSERT INTO push_deliveries(notification_id,account_id,device_id,status)
    SELECT id,recipient_id,uuidv7(),status FROM deadline_notifications`);
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('обновление с R0.7 сохраняет источники, правила, выполненность и прежние доставки', async () => {
  const after = await snapshot();
  // Новое поле технической причины отмены пусто у существующих предупреждений.
  for (const row of after[3] ?? []) {
    delete row.value.cancellation_reason;
    delete row.value.notification_kind;
    for (const key of [
      'event_key',
      'record_table',
      'record_id',
      'event_kind',
      'event_household_id',
    ]) {
      expect(row.value[key]).toBeNull();
      delete row.value[key];
    }
  }
  // Прежние сроки остаются обычными записями без коммунальных ссылок.
  for (const row of after[1] ?? []) {
    expect(row.value).toMatchObject({
      source_kind: 'record',
      utility_account_id: null,
      meter_id: null,
      charge_id: null,
      label: null,
    });
    delete row.value.source_kind;
    delete row.value.utility_account_id;
    delete row.value.meter_id;
    delete row.value.charge_id;
    delete row.value.label;
    expect(row.value.document_id).toBeNull();
    delete row.value.document_id;
    expect(row.value.contact_id).toBeNull();
    expect(row.value.profile_account_id).toBeNull();
    delete row.value.contact_id;
    delete row.value.profile_account_id;
    expect(row.value.task_id).toBeNull();
    delete row.value.task_id;
    expect(row.value.assignee_override_id).toBeNull();
    delete row.value.assignee_override_id;
  }
  expect(after).toEqual(before);
  await runMigrations(db.owner);
});
it('отмена допускает новое предупреждение; отправленная тройка остаётся защищённой от дублей', async () => {
  const insert = (status: string) =>
    db.worker.query(
      `INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at)
    SELECT occurrence_id,recipient_id,warning_at FROM deadline_notifications WHERE status=$1`,
      [status],
    );
  expect((await insert('cancelled')).rowCount).toBe(1);
  await expect(insert('sent')).rejects.toMatchObject({ code: '23505' });
});
