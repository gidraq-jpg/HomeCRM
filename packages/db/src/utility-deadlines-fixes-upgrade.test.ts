import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NOTIFICATION_KINDS } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string, before: unknown;
const family = buildFamily();
const preserved = [
  'objects',
  'objects_history',
  'utility_accounts',
  'utility_accounts_history',
  'meters',
  'meters_history',
  'deadline_occurrences',
  'push_deliveries',
];
async function snapshot() {
  return Promise.all(
    preserved.map(async (table) => ({
      table,
      rows: (await db.admin.query(`SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY id`)).rows,
    })),
  );
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-utility-fixes-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 34);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  const house = family.houses[0]?.id;
  const author = family.person('boris').id;
  const obj = (
    await db.admin.query(
      `INSERT INTO objects(space_id,space_kind,audience,author_id,title)
    VALUES($1,'household','adults',$2,'Вымышленная квартира обновления') RETURNING id`,
      [house, author],
    )
  ).rows[0].id;
  await db.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,data)
    VALUES($1,'household','adults',$2,'Вымышленный счёт обновления',$3,
    '{"readingRule":{"kind":"repeat","anchor":"2026-01-01","repeat":{"unit":"month","day":20,"endDay":25},"warnings":[],"endWarnings":[]},"paymentRule":{"kind":"repeat","anchor":"2026-01-01","repeat":{"unit":"month","day":23},"warnings":[]}}')`,
    [house, author, obj],
  );
  await db.admin.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,completed_at,space_id,space_kind,audience,author_id,assignee_id)
    SELECT id,'2026-09-23','2026-09-23T00:00:00Z','2026-09-23T23:59:59Z','UTC','[]','2026-09-23T12:00:00Z',space_id,space_kind,audience,author_id,assignee_id FROM deadlines WHERE source_kind='payment'`);
  await db.admin.query(`INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at,status)
    SELECT id,assignee_id,starts_at,'sent' FROM deadline_occurrences`);
  await db.admin.query(`INSERT INTO push_deliveries(notification_id,account_id,device_id,status)
    SELECT id,recipient_id,uuidv7(),'sent' FROM deadline_notifications`);
  const choices = [['deadline'], [], ['readings_open'], ['deadline', 'payment_due']];
  for (const [i, person] of family.people.slice(0, 4).entries())
    await db.admin.query(
      'INSERT INTO notification_settings(account_id,enabled_kinds) VALUES($1,$2)',
      [person.id, JSON.stringify(choices[i])],
    );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0035: разворачивает прежний deadline, сохраняя пустой и конкретный выбор', async () => {
  for (const [i, person] of family.people.slice(0, 4).entries()) {
    const kinds = (
      await db.admin.query('SELECT enabled_kinds FROM notification_settings WHERE account_id=$1', [
        person.id,
      ])
    ).rows[0].enabled_kinds;
    expect(kinds).toEqual(i === 1 ? [] : i === 2 ? ['readings_open'] : [...NOTIFICATION_KINDS]);
  }
});
it('0035: сохраняет записи, историю, ручную оплату, UUID и статусы доставок; правит лишь производные правила', async () => {
  expect(await snapshot()).toEqual(before);
  const rules = (await db.admin.query('SELECT rule FROM deadlines')).rows;
  expect(rules).toHaveLength(2);
  expect(rules.every((x) => x.rule.warnings.length === 0)).toBe(true);
  expect(
    (await db.admin.query('SELECT status,notification_kind FROM deadline_notifications')).rows,
  ).toEqual([{ status: 'sent', notification_kind: 'payment_due' }]);
  expect(
    (
      await db.admin.query(
        "SELECT policyname FROM pg_policies WHERE policyname IN ('utility_seed','deadlines_fixes_seed')",
      )
    ).rows,
  ).toEqual([]);
  expect((await db.owner.query('SELECT * FROM deadlines')).rows).toEqual([]);
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
});
