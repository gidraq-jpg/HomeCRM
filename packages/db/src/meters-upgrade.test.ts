import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase;
let folder: string;
let before: unknown;
const snapshot = async () =>
  (
    await db.admin.query(
      `SELECT * FROM (SELECT 'objects' source,(to_jsonb(t) - 'organization_id') data FROM objects t UNION ALL SELECT 'objects_history',(to_jsonb(t) - 'organization_id') FROM objects_history t UNION ALL SELECT 'contacts',(to_jsonb(t) - 'organization_id') FROM contacts t UNION ALL SELECT 'contacts_history',(to_jsonb(t) - 'organization_id') FROM contacts_history t UNION ALL SELECT 'utility_accounts',(to_jsonb(t) - 'organization_id') FROM utility_accounts t UNION ALL SELECT 'utility_accounts_history',(to_jsonb(t) - 'organization_id') FROM utility_accounts_history t) s ORDER BY source,data::text`,
    )
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-meters-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 28);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const family = buildFamily();
  await seedPeople(db.admin, family);
  const place = family.houses[0]?.id;
  const author = family.person('boris').id;
  const obj = await db.admin.query(
    `INSERT INTO objects(space_id,space_kind,audience,author_id,title,object_type,type_data) VALUES($1,'household','adults',$2,'Существующая квартира','property','{"address":"Вымышленная улица","areaHundredths":5731}') RETURNING id`,
    [place, author],
  );
  const contact = await db.admin.query(
    `INSERT INTO contacts(space_id,space_kind,audience,author_id,title) VALUES($1,'household','adults',$2,'Существующая организация') RETURNING id`,
    [place, author],
  );
  await db.admin.query(
    `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,supplier_id) VALUES($1,'household','adults',$2,'Существующий счёт',$3,$4)`,
    [place, author, obj.rows[0].id, contact.rows[0].id],
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0029–0031 сохраняют содержимое, даты и историю объектов, организаций и счетов с 0028', async () => {
  expect(await snapshot()).toEqual(before);
});
it('новые таблицы пусты, значения и расход — numeric[], RLS принудительна', async () => {
  expect((await db.admin.query('SELECT * FROM meters')).rows).toEqual([]);
  expect((await db.admin.query('SELECT * FROM meter_readings')).rows).toEqual([]);
  const cols = (
    await db.admin.query(
      `SELECT attname,format_type(atttypid,atttypmod) AS type FROM pg_attribute WHERE attrelid='meter_readings'::regclass AND attname IN ('values','consumption') ORDER BY attname`,
    )
  ).rows;
  expect(cols).toEqual([
    { attname: 'consumption', type: 'numeric[]' },
    { attname: 'values', type: 'numeric[]' },
  ]);
  const tables = (
    await db.admin.query(
      `SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('meters','meters_history','meter_readings','meter_readings_history')`,
    )
  ).rows;
  expect(tables).toHaveLength(4);
  for (const t of tables) expect(t).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});
