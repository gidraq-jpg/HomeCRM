import {
  type Database,
  documentFiles,
  eq,
  fileBlobs,
  noteFiles,
  objectFiles,
  profileFiles,
  sql,
} from '@homecrm/db';
import type { FileStorage } from './storage.ts';

/** Запущена только ролью worker; пользовательские имена, конверты и содержимое не читаются. */
export async function cleanupFileBlocks(
  worker: Database,
  storage: FileStorage,
  before = new Date(Date.now() - 60 * 60 * 1000),
) {
  let removed = 0;
  for await (const key of storage.olderThan(before))
    await worker.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('file-block-cleanup',0))`);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`file-block:${key}`},0))`,
      );
      const [live] = await tx.select().from(fileBlobs).where(eq(fileBlobs.key, key));
      if (!live) {
        await storage.delete(key);
        removed++;
      }
    });
  return removed;
}
/** Файлы в корзине физически удаляет только worker после 30 дней (DATA-1). */
export async function cleanupFiles(worker: Database, storage: FileStorage, before?: Date) {
  for (const table of [noteFiles, objectFiles, documentFiles, profileFiles])
    await worker.delete(table).where(sql`${table.deletedAt} < now()-interval '30 days'`);
  return cleanupFileBlocks(worker, storage, before);
}
export function scheduleFileCleanup(
  worker: Database,
  storage: FileStorage,
  log: { error(message: string): void },
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await cleanupFiles(worker, storage);
    } catch {
      log.error('File block cleanup failed');
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000).unref();
  return () => clearInterval(timer);
}
