import { eq, sql, type Transaction } from '@homecrm/db';
import { canViewFile } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { factsOf, readReference } from '../objects/support.ts';
import { safeFilename } from './media.ts';
import { type FileServices, fileSummary, fileTable } from './service.ts';

/** Подготовка файлов для архива R0.10; не публикует архив и не возвращает конверты ключей. */
export async function exportFiles(tx: Transaction, account: Account, services: FileServices) {
  await tx.execute(
    sql`select pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))`,
  );
  const result = [];
  for (const type of ['note', 'object'] as const)
    for (const file of await tx.select().from(fileTable(type))) {
      if (file.spaceKind !== 'personal' && account.viewer.memberships.get(file.spaceId) !== 'admin')
        continue;
      const parent = await readReference(tx, account, { type, id: file.parentId });
      if (
        !canViewFile(
          account.viewer,
          factsOf(file, type === 'note' ? 'note_file' : 'object_file'),
          parent.facts,
        )
      )
        continue;
      const data = services.cipher.open(
        await services.storage.get(file.storageKey),
        file.envelope,
        file.storageKey,
      );
      result.push({
        ...fileSummary(file),
        parentType: type,
        parentId: file.parentId,
        archivePath: `files/${file.id}-${safeFilename(file.title)}`,
        data,
      });
    }
  return result;
}
/** Чужому профилю не выдаём даже UUID файла, скрытого от читателя. */
export async function visibleProfileFile(
  tx: Transaction,
  account: Account,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  for (const type of ['note', 'object'] as const) {
    const table = fileTable(type);
    const [file] = await tx.select().from(table).where(eq(table.id, id));
    if (!file || file.deletedAt !== null || !file.mimeType.startsWith('image/')) continue;
    const parent = await readReference(tx, account, { type, id: file.parentId });
    if (parent.row.deletedAt === null && canViewFile(account.viewer, factsOf(file), parent.facts))
      return file.id;
  }
  return null;
}
export async function ownProfileFile(tx: Transaction, account: Account, id: string) {
  if (!(await visibleProfileFile(tx, account, id))) return false;
  for (const type of ['note', 'object'] as const) {
    const table = fileTable(type);
    const [file] = await tx.select().from(table).where(eq(table.id, id));
    if (file?.authorId === account.id) return true;
  }
  return false;
}
