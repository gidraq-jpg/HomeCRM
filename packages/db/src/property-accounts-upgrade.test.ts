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
      `SELECT * FROM (SELECT 'objects' source,to_jsonb(t) data FROM objects t UNION ALL SELECT 'history',to_jsonb(t) FROM objects_history t UNION ALL SELECT 'links',to_jsonb(t) FROM record_links t) snapshot ORDER BY source,data::text`,
    )
  ).rows;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-property-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 27);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  const family = buildFamily();
  await seedPeople(db.admin, family);
  await db.admin.query(
    `INSERT INTO objects(space_id,space_kind,audience,author_id,title,object_type) VALUES($1,'household','adults',$2,'Существующая квартира','property'),($1,'household','household',$2,'Существующая техника','appliance')`,
    [family.houses[0]?.id, family.person('boris').id],
  );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0028 сохраняет существующие объекты, пустой type_data, даты, поиск и историю побайтно', async () => {
  expect(await snapshot()).toEqual(before);
});
it('новые таблицы и истории включают FORCE RLS', async () => {
  const rows = (
    await db.admin.query(
      `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('contacts','contacts_history','utility_accounts','utility_accounts_history')`,
    )
  ).rows;
  expect(rows).toHaveLength(4);
  for (const row of rows)
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
});
