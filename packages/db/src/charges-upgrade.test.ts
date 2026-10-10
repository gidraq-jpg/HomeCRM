import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase;
let folder: string;
const family = buildFamily();
const tables = [
  'objects',
  'objects_history',
  'utility_accounts',
  'utility_accounts_history',
  'meters',
  'meters_history',
  'deadlines',
  'deadline_occurrences',
];
async function snapshot() {
  return Promise.all(
    tables.map(async (table) => ({
      table,
      rows: (
        await db.admin.query(
          `SELECT to_jsonb(t)-ARRAY['label','charge_id','document_id','contact_id','profile_account_id','task_id'] AS data FROM ${table} t ORDER BY id`,
        )
      ).rows,
    })),
  );
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-charges-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 35);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  const author = family.person('boris').id;
  const house = family.houses[0]?.id;
  const object = (
    await db.admin.query(
      "INSERT INTO objects(space_id,space_kind,audience,author_id,title) VALUES($1,'household','adults',$2,'Вымышленная квартира обновления') RETURNING id",
      [house, author],
    )
  ).rows[0].id;
  await db.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,data) VALUES($1,'household','adults',$2,'Вымышленный счёт',$3,'{"paymentRule":{"kind":"repeat","anchor":"2026-01-01","repeat":{"unit":"month","day":15},"warnings":[3,0]}}')`,
    [house, author, object],
  );
  const deadline = (await db.admin.query('SELECT id FROM deadlines WHERE object_id=$1', [object]))
    .rows[0].id;
  await db.admin.query(
    `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,completed_at,space_id,space_kind,audience,author_id,assignee_id) VALUES($1,'2026-11-15','2026-11-14T19:00Z','2026-11-15T18:59:59Z','Asia/Yekaterinburg','[]',now(),$2,'household','adults',$3,$3)`,
    [deadline, house, author],
  );
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0035 → 0037: существующие данные, история, UUID и ручные отметки побайтно сохраняются', async () => {
  const before = await snapshot();
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  expect((await db.admin.query('SELECT count(*)::int AS n FROM utility_charges')).rows[0]).toEqual({
    n: 0,
  });
  expect(
    (
      await db.admin.query(
        "SELECT policyname FROM pg_policies WHERE roles::text[] @> ARRAY['homecrm_owner']::text[] AND policyname LIKE '%seed%' ",
      )
    ).rows,
  ).toEqual([]);
});
