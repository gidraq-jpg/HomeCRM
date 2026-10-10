import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase, folder: string;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-birthdays-upgrade-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 49);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  await db.admin.query(
    `INSERT INTO contacts(space_id,space_kind,author_id,title,kind,data) VALUES($1,'personal',$2,'Вымышленный прежний контакт','person','{"birthday":"--02-29"}')`,
    [family.person('boris').personalSpaceId, family.person('boris').id],
  );
  await db.admin.query("UPDATE member_profiles SET birth_date='1990-10-10' WHERE account_id=$1", [
    family.person('boris').id,
  ]);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0049 → 0052: старые данные и история сохраняются, флаги выключены; повторная миграция ничего не меняет', async () => {
  const snapshot = async () => {
    const result = [];
    for (const table of [
      'contacts',
      'contacts_history',
      'member_profiles',
      'documents',
      'deadlines',
    ])
      result.push({
        table,
        rows: (
          await db.admin.query(
            `SELECT to_jsonb(t)-ARRAY['birthday_enabled','contact_id','profile_account_id'] AS data FROM ${table} t ORDER BY 1`,
          )
        ).rows,
      });
    return result;
  };
  const before = await snapshot();
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  expect(
    (await db.admin.query('SELECT birthday_enabled FROM member_profiles')).rows.every(
      (p) => p.birthday_enabled === false,
    ),
  ).toBe(true);
  expect((await db.admin.query('SELECT * FROM api_operations')).rowCount).toBe(0);
  expect(
    (await db.admin.query("SELECT id FROM deadlines WHERE source_kind='birthday'")).rowCount,
  ).toBe(0);
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
});
