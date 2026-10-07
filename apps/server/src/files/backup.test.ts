import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createWorkerDatabase } from '@homecrm/db';
import { createTestDatabase, type TestDatabase } from '@homecrm/db/testing';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { stageFileBlocks } from '../ops/backup.ts';
import { cleanupFileBlocks } from './cleanup.ts';
import { DirectoryStorage } from './storage.ts';

let folder: string;
let db: TestDatabase;
beforeAll(async () => {
  folder = await mkdtemp(join(tmpdir(), 'homecrm-file-backup-'));
  db = await createTestDatabase(inject('pgAdminUrl'));
});
afterAll(async () => {
  await db?.drop();
  if (folder) await rm(folder, { recursive: true, force: true });
});
it('staging содержит все обязательные блоки; отсутствующий блок даёт безопасную ошибку', async () => {
  const source = join(folder, 'source');
  const target = join(folder, 'stage');
  await mkdir(source);
  const key = randomUUID();
  const data = Buffer.from('fictional ciphertext');
  await writeFile(join(source, key), data);
  await stageFileBlocks(source, target, [key]);
  expect(await readFile(join(target, key))).toEqual(data);
  const missing = randomUUID();
  await expect(stageFileBlocks(source, join(folder, 'missing-stage'), [missing])).rejects.toThrow(
    /^File backup staging failed: a required block is missing or unreadable$/,
  );
});
it('GC ждёт snapshot/staging: удалённая из текущей DB ссылка сохраняет блок снимка', async () => {
  const source = join(folder, 'race');
  const stage = join(folder, 'race-stage');
  const storage = new DirectoryStorage(source);
  const key = randomUUID();
  const data = Buffer.from('fictional encrypted backup block');
  await storage.put(key, data);
  await db.admin.query('INSERT INTO file_blobs(key) VALUES ($1)', [key]);
  const snapshot = await db.admin.connect();
  let cleaning: Promise<number> | undefined;
  try {
    await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await snapshot.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))",
    );
    const keys = (await snapshot.query<{ key: string }>('SELECT key FROM file_blobs')).rows.map(
      (row) => row.key,
    );
    await db.admin.query('DELETE FROM file_blobs WHERE key=$1', [key]);
    cleaning = cleanupFileBlocks(
      createWorkerDatabase(db.worker),
      storage,
      new Date(Date.now() + 1000),
    );
    const deadline = Date.now() + 5000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      waiting =
        (await db.admin.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted"))
          .rowCount !== 0;
      if (!waiting) await delay(10);
    }
    expect(waiting).toBe(true);
    await stageFileBlocks(source, stage, keys);
    await snapshot.query('COMMIT');
    expect(await cleaning).toBe(1);
    expect(await readFile(join(stage, key))).toEqual(data);
    await expect(storage.get(key)).rejects.toThrow();
  } finally {
    await snapshot.query('ROLLBACK');
    snapshot.release();
    await cleaning;
  }
});

it('нечитаемый каталог не превращается в успешную пустую копию', async () => {
  const file = join(folder, 'not-a-directory');
  await writeFile(file, 'fictional');
  await expect(stageFileBlocks(file, join(folder, 'invalid-stage'), [])).rejects.toThrow(
    /^File backup staging failed/,
  );
});
