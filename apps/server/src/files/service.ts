import { randomUUID } from 'node:crypto';
import { type AppDatabase, eq, noteFiles, objectFiles, sql, type Transaction } from '@homecrm/db';
import type { Account } from '../auth/account.ts';
import { columnsOf, placementOf, type Row } from '../objects/support.ts';
import type { FileCipher } from './crypto.ts';
import type { FileStorage } from './storage.ts';

export type ParentType = 'note' | 'object';
export const fileTable = (type: ParentType) => (type === 'note' ? noteFiles : objectFiles);
export type FileRow = typeof noteFiles.$inferSelect;
export interface FileServices {
  storage: FileStorage;
  cipher: FileCipher;
}
const transactions = new WeakMap<Transaction, { services: FileServices; keys: string[] }>();
/** Компенсация выполняется и при ошибке отложенного FK в COMMIT. */
export function fileTransactions(db: AppDatabase, services: FileServices): AppDatabase {
  return {
    async withAccount(accountId, fn) {
      const keys: string[] = [];
      try {
        return await db.withAccount(accountId, async (tx) => {
          transactions.set(tx, { services, keys });
          try {
            return await fn(tx);
          } finally {
            transactions.delete(tx);
          }
        });
      } catch (error) {
        const cleanup = await Promise.allSettled(keys.map((key) => services.storage.delete(key)));
        if (cleanup.some((result) => result.status === 'rejected'))
          throw new Error('File transaction failed; orphan cleanup required', { cause: error });
        throw error;
      }
    },
  };
}
async function storeBlock(tx: Transaction, data: Buffer) {
  const context = transactions.get(tx);
  if (!context) throw new Error('File transaction is unavailable');
  const key = randomUUID();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`file-block:${key}`},0))`);
  const encrypted = context.services.cipher.seal(data, key);
  context.keys.push(key);
  await context.services.storage.put(key, encrypted.block);
  return { key, envelope: encrypted.envelope };
}
export async function insertFile(
  tx: Transaction,
  account: Account,
  type: ParentType,
  parent: Row,
  input: { data: Buffer; mimeType: string; preview?: Buffer; name: string },
) {
  const block = await storeBlock(tx, input.data);
  const preview = input.preview ? await storeBlock(tx, input.preview) : undefined;
  const [row] = await tx
    .insert(fileTable(type))
    .values({
      ...columnsOf(placementOf(parent)),
      parentId: parent.id,
      authorId: account.id,
      title: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.data.length,
      storageKey: block.key,
      envelope: block.envelope,
      previewStorageKey: preview?.key ?? null,
      previewEnvelope: preview?.envelope ?? null,
    })
    .returning();
  if (!row) throw new Error('File insert returned no row');
  return row;
}
export function fileSummary(row: FileRow) {
  return {
    id: row.id,
    name: row.title,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    hasPreview: row.previewStorageKey !== null,
    authorId: row.authorId,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
}
export async function filesOf(tx: Transaction, type: ParentType, parentId: string) {
  const table = fileTable(type);
  return tx
    .select()
    .from(table)
    .where(eq(table.parentId, parentId))
    .orderBy(table.createdAt, table.id);
}
export async function copyFiles(
  tx: Transaction,
  account: Account,
  type: ParentType,
  source: Row,
  target: Row,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))`,
  );
  const rows = (await filesOf(tx, type, source.id)).filter((row) => row.deletedAt === null);
  if (rows.length === 0) return;
  const context = transactions.get(tx);
  if (!context) throw new Error('File transaction is unavailable');
  const { storage, cipher } = context.services;
  for (const row of rows) {
    const data = cipher.open(await storage.get(row.storageKey), row.envelope, row.storageKey);
    const preview = row.previewStorageKey
      ? cipher.open(
          await storage.get(row.previewStorageKey),
          row.previewEnvelope,
          row.previewStorageKey,
        )
      : undefined;
    await insertFile(tx, account, type, target, {
      data,
      mimeType: row.mimeType,
      name: row.title,
      ...(preview ? { preview } : {}),
    });
  }
}
