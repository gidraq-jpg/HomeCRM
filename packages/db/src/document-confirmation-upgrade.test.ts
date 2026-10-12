import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { MIGRATIONS_DIR, runMigrations } from './migrate.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

let db: TestDatabase, folder: string, before: unknown;
let known: string,
  knownPersonal: string,
  unknown: string,
  valid: string,
  exact: Date,
  exactPersonal: Date;
const family = buildFamily();
const app = () => createAppDatabase(db.app);
const author = family.person('boris');
async function snapshot() {
  const rows = [];
  for (const table of ['documents', 'documents_history', 'deadlines', 'search_index'])
    rows.push({
      table,
      data: (
        await db.admin.query(
          `SELECT to_jsonb(t)-'invalidated_at' AS data FROM ${table} t ORDER BY (to_jsonb(t)-'invalidated_at')::text`,
        )
      ).rows,
    });
  return rows;
}
async function create(common: boolean, previousId?: string) {
  return app().withAccount(author.id, async (tx) => {
    const row = (
      await tx.execute<{ id: string }>(sql`
      INSERT INTO documents(space_id,space_kind,audience,author_id,title,data,previous_id)
      VALUES(${common ? family.houses[0]?.id : author.personalSpaceId}::uuid,
      ${common ? 'household' : 'personal'}::space_kind,${common ? 'household' : null}::audience,
      ${author.id}::uuid,'Прежний вымышленный документ','{"type":"contract","indefinite":true}',
      ${previousId ?? null}::uuid) RETURNING id`)
    ).rows[0];
    if (!row) throw new Error('Missing test document');
    return row.id;
  });
}
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-document-confirmation-'));
  await mkdir(join(folder, 'meta'));
  const journal = JSON.parse(await readFile(join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 62);
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
  for (const e of journal.entries)
    await copyFile(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(folder, `${e.tag}.sql`));
  db = await createTestDatabase(inject('pgAdminUrl'), folder);
  await seedPeople(db.admin, family);
  known = await create(true);
  knownPersonal = await create(false);
  unknown = await create(false);
  valid = await create(true);
  for (const id of [known, knownPersonal])
    await app().withAccount(author.id, (tx) =>
      tx.execute(sql`UPDATE documents SET status='invalid' WHERE id=${id}::uuid`),
    );
  exact = (
    await db.admin.query(
      `SELECT created_at FROM documents_history WHERE record_id=$1 AND changes->'status'->>'old'='valid'
     AND changes->'status'->>'new'='invalid'`,
      [known],
    )
  ).rows[0].created_at;
  exactPersonal = (
    await db.admin.query(
      "SELECT created_at FROM documents_history WHERE record_id=$1 AND changes->'status'->>'old'='valid' AND changes->'status'->>'new'='invalid'",
      [knownPersonal],
    )
  ).rows[0].created_at;
  // Старое признание без события истории: сохранённая строка не содержит точной даты.
  await db.admin.query('ALTER TABLE documents DISABLE TRIGGER documents_history');
  try {
    await app().withAccount(author.id, (tx) =>
      tx.execute(sql`UPDATE documents SET status='invalid' WHERE id=${unknown}::uuid`),
    );
  } finally {
    await db.admin.query('ALTER TABLE documents ENABLE TRIGGER documents_history');
  }
  // Более поздняя версия личного документа не доказывает дату прежнего перехода.
  await create(false, unknown);
  for (const id of [known, knownPersonal])
    await app().withAccount(author.id, (tx) =>
      tx.execute(sql`UPDATE documents SET title='Поздняя вымышленная правка' WHERE id=${id}::uuid`),
    );
  before = await snapshot();
  await runMigrations(db.owner);
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('0062 → 0063: прежние строки/история/сроки/поиск неизменны; известная дата из перехода, неизвестная NULL', async () => {
  expect(await snapshot()).toEqual(before);
  await runMigrations(db.owner);
  expect(await snapshot()).toEqual(before);
  const rows = (await db.admin.query('SELECT id,invalidated_at FROM documents')).rows;
  expect(rows.find((r) => r.id === known).invalidated_at).toEqual(exact);
  expect(rows.find((r) => r.id === knownPersonal).invalidated_at).toEqual(exactPersonal);
  expect(rows.find((r) => r.id === unknown).invalidated_at).toBeNull();
  expect(rows.find((r) => r.id === valid).invalidated_at).toBeNull();
});
it('дата под управлением базы: вставка, смена статуса, правка; подмена запрещена, worker не читает тексты/историю', async () => {
  await expect(
    app().withAccount(author.id, (tx) =>
      tx.execute(sql`UPDATE documents SET invalidated_at=now() WHERE id=${known}::uuid`),
    ),
  ).rejects.toThrow();
  await app().withAccount(author.id, (tx) =>
    tx.execute(sql`UPDATE documents SET status='invalid' WHERE id=${valid}::uuid`),
  );
  await app().withAccount(author.id, (tx) =>
    tx.execute(sql`UPDATE documents SET assignee_id=assignee_id WHERE id=${unknown}::uuid`),
  );
  expect(
    (await db.admin.query('SELECT invalidated_at FROM documents WHERE id=$1', [unknown])).rows[0]
      .invalidated_at,
  ).toBeNull();
  const recorded = (
    await db.admin.query('SELECT invalidated_at FROM documents WHERE id=$1', [valid])
  ).rows[0].invalidated_at;
  expect(recorded).toBeInstanceOf(Date);
  await app().withAccount(author.id, (tx) =>
    tx.execute(sql`UPDATE documents SET title='Другая вымышленная правка' WHERE id=${valid}::uuid`),
  );
  expect(
    (await db.admin.query('SELECT invalidated_at FROM documents WHERE id=$1', [valid])).rows[0]
      .invalidated_at,
  ).toEqual(recorded);
  const inserted = await app().withAccount(author.id, (tx) =>
    tx.execute<{ invalidated_at: Date; created_at: Date }>(sql`
    INSERT INTO documents(space_id,space_kind,author_id,title,data,status,invalidated_at)
    VALUES(${author.personalSpaceId}::uuid,'personal',${author.id}::uuid,'Вымышленное признание',
    '{"type":"contract","indefinite":true}','invalid','2099-01-01T00:00Z')
    RETURNING invalidated_at,created_at`),
  );
  expect(inserted.rows[0]?.invalidated_at).toEqual(inserted.rows[0]?.created_at);
  await expect(db.worker.query('SELECT invalidated_at FROM documents')).resolves.toBeDefined();
  for (const query of [
    'SELECT title FROM documents',
    'SELECT updated_at FROM documents',
    'SELECT changes FROM documents_history',
  ])
    await expect(db.worker.query(query)).rejects.toThrow();
  const policy = (
    await db.admin.query(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='documents'::regclass",
    )
  ).rows[0];
  expect(policy).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});
