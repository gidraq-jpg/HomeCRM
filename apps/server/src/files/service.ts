import { randomUUID } from 'node:crypto';
import {
  type AppDatabase,
  eq,
  memberProfiles,
  noteFiles,
  objectFiles,
  profileFiles,
  sql,
  type Transaction,
} from '@homecrm/db';
import type { Account } from '../auth/account.ts';
import { columnsOf, deny, placementOf, type Row } from '../objects/support.ts';
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
/** После успешного тела исход COMMIT может быть неизвестен: блоки проверяет фоновая сверка. */
export function fileTransactions(db: AppDatabase, services: FileServices): AppDatabase {
  return {
    async withAccount(accountId, fn, options) {
      const keys: string[] = [];
      let bodyFinished = false;
      try {
        return await db.withAccount(
          accountId,
          async (tx) => {
            transactions.set(tx, { services, keys });
            try {
              const result = await fn(tx);
              bodyFinished = true;
              return result;
            } finally {
              transactions.delete(tx);
            }
          },
          options,
        );
      } catch (error) {
        if (bodyFinished) throw error;
        const cleanup = await Promise.allSettled(keys.map((key) => services.storage.delete(key)));
        if (cleanup.some((result) => result.status === 'rejected'))
          throw new Error('File transaction failed; orphan cleanup required', { cause: error });
        throw error;
      }
    },
  };
}
type FileInput = { data: Buffer; mimeType: string; preview?: Buffer; name: string };
type SealedBlock = ReturnType<FileCipher['seal']> & { key: string };
export interface PreparedUpload {
  block: SealedBlock;
  preview?: SealedBlock;
  mimeType: string;
  name: string;
  sizeBytes: number;
}
/** Шифрование выполняется до транзакции, блоки пока остаются в памяти. */
export function prepareUpload(services: FileServices, input: FileInput): PreparedUpload {
  const seal = (data: Buffer): SealedBlock => {
    const key = randomUUID();
    return { key, ...services.cipher.seal(data, key) };
  };
  return {
    block: seal(input.data),
    ...(input.preview ? { preview: seal(input.preview) } : {}),
    mimeType: input.mimeType,
    name: input.name,
    sizeBytes: input.data.length,
  };
}
async function storeBlock(tx: Transaction, block: SealedBlock) {
  const context = transactions.get(tx);
  if (!context) throw new Error('File transaction is unavailable');
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`file-block:${block.key}`},0))`,
  );
  context.keys.push(block.key);
  await context.services.storage.put(block.key, block.block);
}
export async function insertPreparedFile(
  tx: Transaction,
  account: Account,
  type: ParentType,
  parent: Row,
  input: PreparedUpload,
) {
  await storeBlock(tx, input.block);
  if (input.preview) await storeBlock(tx, input.preview);
  const [row] = await tx
    .insert(fileTable(type))
    .values({
      ...columnsOf(placementOf(parent)),
      parentId: parent.id,
      authorId: account.id,
      title: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.block.key,
      envelope: input.block.envelope,
      previewStorageKey: input.preview?.key ?? null,
      previewEnvelope: input.preview?.envelope ?? null,
    })
    .returning();
  if (!row) throw new Error('File insert returned no row');
  return row;
}
export async function insertFile(
  tx: Transaction,
  account: Account,
  type: ParentType,
  parent: Row,
  input: FileInput,
) {
  const context = transactions.get(tx);
  if (!context) throw new Error('File transaction is unavailable');
  return insertPreparedFile(tx, account, type, parent, prepareUpload(context.services, input));
}
export async function insertProfileFile(tx: Transaction, account: Account, input: PreparedUpload) {
  await storeBlock(tx, input.block);
  if (input.preview) await storeBlock(tx, input.preview);
  const [row] = await tx
    .insert(profileFiles)
    .values({
      accountId: account.id,
      title: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: input.block.key,
      envelope: input.block.envelope,
      previewStorageKey: input.preview?.key ?? null,
      previewEnvelope: input.preview?.envelope ?? null,
    })
    .returning();
  if (!row) throw new Error('Profile file insert returned no row');
  return row;
}
/** Блокировка профиля сериализует замену, снятие фото и восстановление. */
export async function lockProfile(tx: Transaction, account: Account) {
  const [profile] = await tx
    .select()
    .from(memberProfiles)
    .where(eq(memberProfiles.accountId, account.id))
    .for('update');
  if (!profile) deny();
  return profile;
}
export async function setProfilePhoto(tx: Transaction, account: Account, id: string | null) {
  const profile = await lockProfile(tx, account);
  if (id) {
    const [file] = await tx.select().from(profileFiles).where(eq(profileFiles.id, id));
    if (!file || file.accountId !== account.id || file.deletedAt !== null) deny();
  }
  const [updated] = await tx
    .update(memberProfiles)
    .set({ photoFileId: id })
    .where(eq(memberProfiles.accountId, account.id))
    .returning();
  if (profile.photoFileId && profile.photoFileId !== id)
    await tx
      .update(profileFiles)
      .set({ deletedAt: new Date() })
      .where(eq(profileFiles.id, profile.photoFileId));
  return updated;
}
export function fileSummary(row: FileRow | typeof profileFiles.$inferSelect) {
  return {
    id: row.id,
    name: row.title,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    hasPreview: row.previewStorageKey !== null,
    authorId: 'authorId' in row ? row.authorId : row.accountId,
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
  const copies = new Map<string, string>();
  if (rows.length === 0) return copies;
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
    const copy = await insertFile(tx, account, type, target, {
      data,
      mimeType: row.mimeType,
      name: row.title,
      ...(preview ? { preview } : {}),
    });
    copies.set(row.id, copy.id);
  }
  return copies;
}
