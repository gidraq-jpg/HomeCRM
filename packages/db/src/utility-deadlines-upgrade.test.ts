import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string, before: unknown, objectId: string;
const tables = [
  'objects',
  'objects_history',
  'utility_accounts',
  'utility_accounts_history',
  'meters',
  'meters_history',
  'meter_readings',
  'meter_readings_history',
];
async function snapshot() {
  const rows = [];
  for (const table of tables)
    rows.push({
      table,
      rows: (
        await db.admin.query(`SELECT to_jsonb(t)-'is_active' AS data FROM ${table} t ORDER BY id`)
      ).rows,
    });
  return rows;
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-utility-deadlines-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 31);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const family = buildFamily();
  await seedPeople(db.admin, family);
  const author = family.person('boris').id;
  const house = family.houses[0]?.id;
  objectId = (
    await db.admin.query(
      `INSERT INTO objects(space_id,space_kind,audience,author_id,title) VALUES($1,'household','adults',$2,'Существующая вымышленная квартира') RETURNING id`,
      [house, author],
    )
  ).rows[0].id;
  const acc = (
    await db.admin.query(
      `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,data) VALUES($1,'household','adults',$2,'Существующий вымышленный счёт',$3,'{"readingRule":{"kind":"repeat","anchor":"2026-01-01","repeat":{"unit":"month","day":20,"endDay":25}},"paymentRule":{"kind":"repeat","anchor":"2026-01-01","repeat":{"unit":"month","day":23}}}') RETURNING id`,
      [house, author, objectId],
    )
  ).rows[0].id;
  const meter = (
    await db.admin.query(
      `INSERT INTO meters(space_id,space_kind,audience,author_id,title,parent_id,utility_account_id,data) VALUES($1,'household','adults',$2,'Существующий вымышленный счётчик',$3,$4,'{"resource":"cold_water","status":"active","nextVerificationOn":"2026-12-01"}') RETURNING id`,
      [house, author, objectId, acc],
    )
  ).rows[0].id;
  await db.admin.query(
    `INSERT INTO meter_readings(space_id,space_kind,audience,author_id,title,parent_id,occurred_on,values) VALUES($1,'household','adults',$2,'Существующее вымышленное показание',$3,'2026-10-01',ARRAY[999999999999.123456]::numeric[])`,
    [house, author, meter],
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0032–0034 сохраняют пользовательские записи, точность, даты и всю историю заполненной 0031', async () => {
  expect(await snapshot()).toEqual(before);
});
it('существующие источники получили три производных срока без остаточных политик владельца', async () => {
  const rows = (
    await db.admin.query(
      'SELECT source_kind,assignee_id,object_id FROM deadlines ORDER BY source_kind',
    )
  ).rows;
  expect(rows.map((r) => r.source_kind)).toEqual(['payment', 'readings', 'verification']);
  expect(rows.every((r) => r.object_id === objectId)).toBe(true);
  expect(
    (await db.admin.query("SELECT policyname FROM pg_policies WHERE policyname='utility_seed'"))
      .rows,
  ).toEqual([]);
  expect((await db.owner.query('SELECT * FROM deadlines')).rows).toEqual([]);
});
