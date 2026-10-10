import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string;
const family = buildFamily();
const tables = [
  'objects',
  'objects_history',
  'contacts',
  'contacts_history',
  'utility_accounts',
  'utility_accounts_history',
  'utility_charges',
  'utility_charges_history',
  'utility_payments',
  'utility_payments_history',
  'deadlines',
  'deadline_occurrences',
];
async function snapshot() {
  const result = [];
  for (const table of tables)
    result.push({
      table,
      rows: (
        await db.admin.query(
          `SELECT to_jsonb(t)-ARRAY['organization_id','document_id','contact_id','profile_account_id','task_id','assignee_override_id','event_key','record_table','record_id','event_kind','event_household_id'] AS data FROM ${table} t ORDER BY id`,
        )
      ).rows,
    });
  return result;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-documents-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 37);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  const author = family.person('boris').id,
    house = family.houses[0]?.id;
  const obj = (
    await db.admin.query(
      "INSERT INTO objects(space_id,space_kind,audience,author_id,title) VALUES($1,'household','adults',$2,'Вымышленная квартира обновления документов') RETURNING id",
      [house, author],
    )
  ).rows[0].id;
  const acc = (
    await db.admin.query(
      "INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id) VALUES($1,'household','adults',$2,'Вымышленный счёт',$3) RETURNING id",
      [house, author, obj],
    )
  ).rows[0].id;
  const charge = (
    await db.admin.query(
      "INSERT INTO utility_charges(space_id,space_kind,audience,author_id,title,parent_id,period,total_cents,due_on) VALUES($1,'household','adults',$2,'Вымышленное начисление',$3,'2026-10',10000,'2026-11-15') RETURNING id",
      [house, author, acc],
    )
  ).rows[0].id;
  await db.admin.query(
    `INSERT INTO utility_payments(space_id,space_kind,audience,author_id,title,parent_id,paid_on,amount_cents,payer,method) VALUES($1,'household','adults',$2,'Вымышленная частичная оплата',$3,'2026-10-08',2500,'{"kind":"tenant"}','tenant')`,
    [house, author, charge],
  );
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0037 → документы: содержимое, история, деньги и сроки старых записей сохраняются полностью', async () => {
  const before = await snapshot();
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  expect((await db.admin.query('SELECT count(*)::int AS n FROM documents')).rows[0]).toEqual({
    n: 0,
  });
  expect(
    (
      await db.admin.query(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('documents','document_files')",
      )
    ).rows,
  ).toEqual([
    { relrowsecurity: true, relforcerowsecurity: true },
    { relrowsecurity: true, relforcerowsecurity: true },
  ]);
});
