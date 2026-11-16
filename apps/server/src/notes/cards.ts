// Состав заметки для ответов API и выгрузки. Без маршрутов: этот файл импортируют другие модули.

import { eq, noteItems, type notes, type Transaction } from '@homecrm/db';
import type { Placement } from '@homecrm/shared';
import { fileSummary, filesOf } from '../files/service.ts';

export type Note = typeof notes.$inferSelect;
export type Item = typeof noteItems.$inferSelect;

export function placementOf(
  record: Pick<Note, 'spaceId' | 'spaceKind' | 'audience' | 'assigneeId'>,
): Placement {
  return record.spaceKind === 'personal'
    ? { kind: 'personal', spaceId: record.spaceId, ownerId: record.assigneeId ?? '' }
    : { kind: 'household', spaceId: record.spaceId, audience: record.audience ?? 'household' };
}
export function summary(record: Note) {
  const {
    id,
    title,
    pinned,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  } = record;
  return {
    id,
    title,
    pinned,
    spaceId,
    spaceKind,
    audience,
    authorId,
    assigneeId,
    createdAt,
    updatedAt,
    deletedAt,
  };
}
export async function itemsOf(tx: Transaction, id: string): Promise<Item[]> {
  return tx
    .select()
    .from(noteItems)
    .where(eq(noteItems.parentId, id))
    .orderBy(noteItems.position, noteItems.id);
}
export async function card(tx: Transaction, record: Note, includeDeleted = false) {
  return {
    ...summary(record),
    files: (await filesOf(tx, 'note', record.id))
      .filter((file) => includeDeleted || record.deletedAt !== null || file.deletedAt === null)
      .map(fileSummary),
    body: record.body,
    checklist: (await itemsOf(tx, record.id))
      .filter((item) => includeDeleted || record.deletedAt !== null || item.deletedAt === null)
      .map(({ id, title, done, position, deletedAt }) => ({
        id,
        title,
        done,
        position,
        deletedAt,
      })),
  };
}
