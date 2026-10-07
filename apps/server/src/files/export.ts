import { eq, memberProfiles, profileFiles, spaceMembers, sql, type Transaction } from '@homecrm/db';
import { canViewFile, canViewProfileFile } from '@homecrm/shared';
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
  // Фото профиля экспортирует только сам владелец, включая снятые фото.
  for (const file of await tx
    .select()
    .from(profileFiles)
    .where(eq(profileFiles.accountId, account.id))) {
    result.push({
      ...fileSummary(file),
      parentType: 'profile',
      parentId: account.id,
      archivePath: `files/${file.id}-${safeFilename(file.title)}`,
      data: services.cipher.open(
        await services.storage.get(file.storageKey),
        file.envelope,
        file.storageKey,
      ),
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
  const [file] = await tx.select().from(profileFiles).where(eq(profileFiles.id, id));
  return file && file.deletedAt === null && (await visibleProfilePhoto(tx, account, file))
    ? file.id
    : null;
}
/** Двойная проверка: RLS и эталон access.ts, с учётом действующего фото и членств владельца. */
export async function visibleProfilePhoto(
  tx: Transaction,
  account: Account,
  file: typeof profileFiles.$inferSelect,
) {
  const [profile] = await tx
    .select()
    .from(memberProfiles)
    .where(eq(memberProfiles.accountId, file.accountId));
  const memberships = await tx
    .select()
    .from(spaceMembers)
    .where(eq(spaceMembers.accountId, file.accountId));
  return canViewProfileFile(
    account.viewer,
    file.accountId,
    memberships.filter((m) => m.leftAt === null).map((m) => m.spaceId),
    file.deletedAt !== null,
    profile?.photoFileId === file.id,
  );
}
