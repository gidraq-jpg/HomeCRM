// R1c.4c: матрица соблюдает тот же порядок блокировок документа и вложения, что API.
import { setTimeout } from 'node:timers/promises';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { type AppDatabase, createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, type SeededRecord, seedFamily } from './testing/family.ts';
import { runMatrix, updateRecord } from './testing/matrix.ts';

let database: TestDatabase;
let app: AppDatabase;
const family = buildFamily();
let file: SeededRecord;
const rollback = new Error('matrix lock regression rollback');

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  app = createAppDatabase(database.app);
  const { rows } = await database.admin.query<{ id: string }>(`
    SELECT f.id FROM document_files f JOIN documents d ON d.id=f.parent_id
    JOIN space_members m ON m.space_id=d.space_id AND m.account_id=d.author_id
    WHERE d.space_kind='household' AND m.role IN ('adult','admin')
      AND d.author_id=f.author_id AND d.deleted_at IS NULL AND f.deleted_at IS NULL LIMIT 1
  `);
  const fixture = family.records.find((record) => record.id === rows[0]?.id);
  if (!fixture) throw new Error('Document file fixture missing');
  file = fixture;
});

afterAll(async () => {
  await database?.drop();
});

it('документ → вложение: ожидающая операция матрицы не удерживает вложение', async () => {
  const parent = await database.app.connect();
  let finishChild: Promise<unknown> | undefined;
  try {
    await parent.query('BEGIN');
    await parent.query("SELECT set_config('app.account_id',$1,true)", [file.facts.authorId]);
    await parent.query('SELECT id FROM documents WHERE id=$1 FOR UPDATE', [file.parentId]);
    const childPid = Promise.withResolvers<number>();
    finishChild = app
      .withAccount(file.facts.authorId, async (tx) => {
        const pid = await tx.execute<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        childPid.resolve(pid.rows[0]?.pid ?? 0);
        expect(await updateRecord(tx, file, { deletedAt: new Date() })).toBe(true);
        throw rollback;
      })
      .then(
        () => ({ ok: false, error: 'missing rollback' }),
        (error: unknown) => ({ ok: error === rollback, error }),
      );
    const pid = await childPid.promise;
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      const result = await database.owner.query<{ waiting: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting',
        [pid],
      );
      waiting = result.rows[0]?.waiting === true;
      if (!waiting) await setTimeout(20);
    }
    expect(waiting).toBe(true);
    // Если ребёнок уже заблокировал вложение, этот каскад замкнёт цикл и даст 40P01.
    const parentResult = await parent
      .query('UPDATE documents SET deleted_at=clock_timestamp() WHERE id=$1', [file.parentId])
      .then(
        (result) => ({ ok: result.rowCount === 1, error: undefined }),
        (error: unknown) => ({ ok: false, error }),
      );
    await parent.query('ROLLBACK');
    const childResult = await finishChild;
    expect(parentResult).toEqual({ ok: true, error: undefined });
    expect(childResult).toEqual({ ok: true, error: rollback });
  } finally {
    await parent.query('ROLLBACK');
    parent.release();
    await finishChild;
  }
});

it.each(['trash', 'delete'] as const)(
  '%s: все попытки для документов и вложений сохранены',
  async (operation) => {
    const types = ['document', 'document_file'] as const;
    const records = family.records.filter(
      (record) =>
        types.includes(record.type as (typeof types)[number]) &&
        (operation === 'delete' || !record.trashed),
    );
    const report = await runMatrix(app, family, operation, types);
    expect(report.checks).toBe(records.length * family.people.length);
    expect(report.mismatches).toEqual([]);
  },
);
