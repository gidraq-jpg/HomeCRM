import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentData } from '@homecrm/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { MIGRATIONS_DIR } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string;
const family = buildFamily();
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-passport-milestone-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 52);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  for (const [index, birthday] of ['2006-12-01', '1981-12-01', null, '2006-12-01'].entries()) {
    const contact = (
      await db.admin.query(
        `INSERT INTO contacts(space_id,space_kind,author_id,title,kind,data) VALUES($1,'personal',$2,'Вымышленный прежний владелец','person',$3::jsonb) RETURNING id`,
        [
          family.person('boris').personalSpaceId,
          family.person('boris').id,
          JSON.stringify({ birthday }),
        ],
      )
    ).rows[0].id;
    await createAppDatabase(db.app).withAccount(family.person('boris').id, (tx) =>
      tx.execute(sql`INSERT INTO documents(space_id,space_kind,author_id,title,owner_contact_id,data)
        VALUES(${family.person('boris').personalSpaceId}::uuid,'personal',${family.person('boris').id}::uuid,
        'Вымышленный прежний паспорт',${contact}::uuid,${JSON.stringify(DocumentData.parse({ type: 'russian_passport', issuedOn: birthday?.startsWith('1981') ? '2002-01-01' : '2020-01-01', warnings: [17, 3] }))}::jsonb)`),
    );
    if (index === 3)
      await createAppDatabase(db.app).withAccount(family.person('boris').id, (tx) =>
        tx.execute(sql`UPDATE documents SET space_id=${family.houses[0]?.id}::uuid,
          space_kind='household',audience='household' WHERE owner_contact_id=${contact}::uuid`),
      );
  }
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0052 → 0053: дополняется лишь граница прежнего окна, неизвестная дата, источники и история сохраняются', async () => {
  const snapshot = async () => {
    const result = [];
    for (const table of ['documents', 'documents_history', 'contacts', 'contacts_history'])
      result.push({
        table,
        rows: (await db.admin.query(`SELECT to_jsonb(t) AS data FROM ${table} t ORDER BY 1`)).rows,
      });
    return result;
  };
  const before = await snapshot();
  const rules = (await db.admin.query('SELECT id,rule FROM deadlines ORDER BY id')).rows;
  const guard = (
    await db.admin.query("SELECT pg_get_functiondef('app.deadline_guard()'::regprocedure) AS body")
  ).rows[0].body;
  // Этот тест проверяет именно 0053, новые миграции проверяются отдельно.
  const target = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  target.entries = target.entries.filter((entry: { idx: number }) => entry.idx <= 53);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(target));
  for (const entry of target.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  await migrate(drizzle({ client: db.owner }), { migrationsFolder: folder });
  expect(await snapshot()).toEqual(before);
  const after = (await db.admin.query('SELECT id,rule FROM deadlines ORDER BY id')).rows;
  expect(
    after.map((row) => ({
      id: row.id,
      rule: Object.fromEntries(Object.entries(row.rule).filter(([key]) => key !== 'passportYears')),
    })),
  ).toEqual(rules);
  expect(
    after
      .map((row) => row.rule.passportYears)
      .filter(Boolean)
      .sort(),
  ).toEqual([20, 45]);
  expect(
    (
      await db.admin.query(
        "SELECT pg_get_functiondef('app.deadline_guard()'::regprocedure) AS body",
      )
    ).rows[0].body,
  ).toBe(guard);
  expect(
    (await db.admin.query("SELECT policyname FROM pg_policies WHERE policyname LIKE 'milestone_%'"))
      .rows,
  ).toEqual([]);
  await migrate(drizzle({ client: db.owner }), { migrationsFolder: folder });
  expect((await db.admin.query('SELECT id,rule FROM deadlines ORDER BY id')).rows).toEqual(after);
});
