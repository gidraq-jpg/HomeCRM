import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string, passport: string, organization: string, explicit: string;
const family = buildFamily();
const tables = [
  'contacts',
  'contacts_history',
  'documents',
  'documents_history',
  'objects',
  'objects_history',
  'utility_accounts',
  'utility_accounts_history',
];
async function snapshot() {
  const result = [];
  for (const t of tables)
    result.push({
      table: t,
      rows: (
        await db.admin.query(`SELECT to_jsonb(t)-'organization_id' AS data FROM ${t} t ORDER BY id`)
      ).rows,
    });
  return result;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-people-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const j = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  j.entries = j.entries.filter((e: { idx: number }) => e.idx <= 43);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(j), 'utf8');
  for (const e of j.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  const author = family.person('boris'),
    house = family.houses[0]?.id;
  await db.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE id=$1", [house]);
  await db.admin.query("UPDATE member_profiles SET birth_date='2006-12-01' WHERE account_id=$1", [
    author.id,
  ]);
  organization = (
    await db.admin.query(
      'INSERT INTO contacts(space_id,space_kind,audience,author_id,title,data) VALUES($1,\'household\',\'household\',$2,\'Вымышленная организация обновления\',\'{"organizationType":"management","phones":[{"number":"+79000000000","label":"Аварийный","emergency":true}],"website":null,"address":"Вымышленная улица","openingHours":"9–18","note":"Вымышленная заметка"}\') RETURNING id',
      [house, author.id],
    )
  ).rows[0].id;
  passport = (
    await db.admin.query(
      'INSERT INTO documents(space_id,space_kind,author_id,title,owner_account_id,data) VALUES($1,\'personal\',$2,\'Вымышленный паспорт обновления\',$2,\'{"type":"russian_passport","issuedOn":"2020-01-01","indefinite":false}\') RETURNING id',
      [author.personalSpaceId, author.id],
    )
  ).rows[0].id;
  explicit = (
    await db.admin.query(
      `INSERT INTO documents(space_id,space_kind,author_id,title,data)
       VALUES($1,'personal',$2,'Вымышленный загранпаспорт обновления',
       '{"type":"international_passport","expiresOn":"2030-01-01","indefinite":false}') RETURNING id`,
      [author.personalSpaceId, author.id],
    )
  ).rows[0].id;
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0043 → люди и паспорт: исходные данные и история побайтно прежние; индекс и правило построены', async () => {
  const before = await snapshot();
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  expect(
    (await db.admin.query('SELECT rule FROM deadlines WHERE document_id=$1', [explicit])).rows,
  ).toMatchObject([{ rule: { date: '2030-01-01', warnings: [180, 90, 30] } }]);
  expect(
    (await db.admin.query('SELECT rule FROM deadlines WHERE document_id=$1', [passport])).rows,
  ).toMatchObject([{ rule: { date: '2026-12-01', durationDays: 90, warnings: [60, 30] } }]);
  expect(
    (
      await db.admin.query(
        "SELECT content FROM search_index WHERE source_type='contact' AND source_id=$1",
        [organization],
      )
    ).rows,
  ).toEqual([{ content: 'Вымышленная организация обновления' }]);
  expect(
    (await db.admin.query("SELECT policyname FROM pg_policies WHERE policyname LIKE '%backfill%' "))
      .rows,
  ).toEqual([]);
  expect(
    (
      await db.admin.query(
        "SELECT pg_get_functiondef('app.deadline_guard()'::regprocedure) AS body",
      )
    ).rows[0].body,
  ).not.toContain('app.passport_backfill');
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
});
