import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase | undefined;
let folder: string | undefined;
const family = buildFamily();

async function beforeMigration(last: number) {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-passport-visibility-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= last);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal), 'utf8');
  for (const entry of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  await db.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE kind='household'");
  return db;
}
afterEach(async () => {
  await db?.drop();
  db = undefined;
  if (folder) await rm(folder, { recursive: true, force: true });
  folder = undefined;
});

it('0046 → 0049: бэкфилл не раскрывает личную, взрослую дату контакта и профиль другой семьи', async () => {
  const database = await beforeMigration(46);
  const author = family.person('boris');
  const house = family.houses[0]?.id;
  const app = createAppDatabase(database.app);
  const documents: { id: string; visible: boolean }[] = [];
  for (const audience of ['personal', 'adults', 'household'] as const) {
    const result = await app.withAccount(author.id, async (tx) => {
      const contact = (
        await tx.execute<{ id: string }>(sql`
        INSERT INTO contacts(space_id,space_kind,audience,author_id,title,kind,data)
        VALUES(${audience === 'personal' ? author.personalSpaceId : house},${audience === 'personal' ? 'personal' : 'household'},${audience === 'personal' ? null : audience},${author.id},'Вымышленный контакт бэкфилла','person','{"birthday":"2006-12-01"}') RETURNING id`)
      ).rows[0];
      return (
        await tx.execute<{ id: string }>(sql`
        INSERT INTO documents(space_id,space_kind,audience,author_id,title,owner_contact_id,data)
        VALUES(${house},'household','household',${author.id},'Вымышленный общий паспорт бэкфилла',${contact?.id},'{"type":"russian_passport","issuedOn":"2020-01-01","indefinite":false}') RETURNING id`)
      ).rows[0];
    });
    if (!result) throw new Error('Missing passport fixture');
    documents.push({ id: result.id, visible: audience === 'household' });
  }
  const owner = family.person('dina');
  await database.admin.query(
    "INSERT INTO space_members(space_id,account_id,role) VALUES($1,$2,'adult')",
    [family.houses[1]?.id, author.id],
  );
  await database.admin.query(
    "UPDATE member_profiles SET birth_date='2006-12-01' WHERE account_id=$1",
    [owner.id],
  );
  const profileDocument = await app.withAccount(author.id, (tx) =>
    tx.execute<{ id: string }>(sql`
    INSERT INTO documents(space_id,space_kind,audience,author_id,title,owner_account_id,data)
    VALUES(${house},'household','household',${author.id},'Вымышленный паспорт другой семьи',${owner.id},'{"type":"russian_passport","issuedOn":"2020-01-01","indefinite":false}') RETURNING id`),
  );
  const id = profileDocument.rows[0]?.id;
  if (!id) throw new Error('Missing profile passport fixture');
  documents.push({ id, visible: false });
  expect((await database.admin.query('SELECT * FROM deadlines')).rows).toHaveLength(0);
  const before = (
    await database.admin.query('SELECT to_jsonb(d) AS data FROM documents d ORDER BY id')
  ).rows;
  await runMigrations(database.owner);
  expect(
    (await database.admin.query('SELECT to_jsonb(d) AS data FROM documents d ORDER BY id')).rows,
  ).toEqual(before);
  for (const document of documents) {
    const read = await app.withAccount(family.person('vera').id, (tx) =>
      tx.execute<{ rule: unknown }>(
        sql`SELECT rule FROM deadlines WHERE document_id=${document.id}`,
      ),
    );
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0]?.rule).toMatchObject(
      document.visible
        ? { date: '2026-12-01', durationDays: 90 }
        : { kind: 'after', eventDate: null },
    );
    if (document.visible) {
      const direct = await app.withAccount(author.id, (tx) =>
        tx.execute<{ visible: boolean }>(sql`
        SELECT app.passport_birth_visible(d,c) AS visible FROM documents d
        JOIN contacts c ON c.id=d.owner_contact_id WHERE d.id=${document.id}`),
      );
      expect(direct.rows).toEqual([{ visible: false }]);
    }
  }
  expect(
    (
      await database.admin.query(
        "SELECT policyname FROM pg_policies WHERE policyname LIKE '%backfill%' ",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await database.admin.query(
        "SELECT pg_get_functiondef('app.deadline_guard()'::regprocedure) AS body",
      )
    ).rows[0].body,
  ).not.toContain('app.passport_backfill');
});

it('0048 → 0049: последнее открытое правило и история сохраняются после закрытия контакта', async () => {
  const database = await beforeMigration(48);
  const app = createAppDatabase(database.app);
  const author = family.person('boris');
  const house = family.houses[0]?.id;
  const ids = await app.withAccount(author.id, async (tx) => {
    const contact = (
      await tx.execute<{ id: string }>(sql`
      INSERT INTO contacts(space_id,space_kind,audience,author_id,title,kind,data)
      VALUES(${house},'household','household',${author.id},'Вымышленный контакт сохранения','person','{"birthday":"2006-12-01"}') RETURNING id`)
    ).rows[0]?.id;
    const document = (
      await tx.execute<{ id: string }>(sql`
      INSERT INTO documents(space_id,space_kind,audience,author_id,title,owner_contact_id,data)
      VALUES(${house},'household','household',${author.id},'Вымышленный паспорт сохранения',${contact},'{"type":"russian_passport","issuedOn":"2020-01-01","indefinite":false}') RETURNING id`)
    ).rows[0]?.id;
    return { contact, document };
  });
  await database.admin.query("UPDATE contacts SET audience='adults' WHERE id=$1", [ids.contact]);
  await app.withAccount(author.id, (tx) =>
    tx.execute(sql`UPDATE contacts SET data='{"birthday":"2006-11-10"}' WHERE id=${ids.contact}`),
  );
  const before = (
    await database.admin.query('SELECT rule,deleted_at FROM deadlines WHERE document_id=$1', [
      ids.document,
    ])
  ).rows;
  expect(before).toMatchObject([{ rule: { date: '2026-12-01' }, deleted_at: null }]);
  const history = (await database.admin.query('SELECT * FROM documents_history ORDER BY id')).rows;
  await runMigrations(database.owner);
  expect(
    (
      await database.admin.query('SELECT rule,deleted_at FROM deadlines WHERE document_id=$1', [
        ids.document,
      ])
    ).rows,
  ).toEqual(before);
  expect((await database.admin.query('SELECT * FROM documents_history ORDER BY id')).rows).toEqual(
    history,
  );
});
