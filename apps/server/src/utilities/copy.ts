import { and, eq, isNull, meterReadings, meters, recordLinks, type Transaction } from '@homecrm/db';
import { canView } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { columnsOf, deny, placementOf, type Row } from '../objects/support.ts';

/** Копия получает новые id и автора; ссылки указывают только на скопированное дерево. */
export async function copyMeters(
  tx: Transaction,
  account: Account,
  source: Row,
  target: Row,
  accounts: Map<string, string>,
  files: Map<string, string>,
) {
  const rows = await tx
    .select()
    .from(meters)
    .where(and(eq(meters.parentId, source.id), isNull(meters.deletedAt)))
    .orderBy(meters.createdAt, meters.id);
  const copies = new Map<string, string>();
  for (const row of rows) {
    if (!canView(account.viewer, placementOf(row))) continue;
    const [copy] = await tx
      .insert(meters)
      .values({
        ...columnsOf(placementOf(target)),
        parentId: target.id,
        authorId: account.id,
        title: row.title,
        data: row.data,
        utilityAccountId: row.utilityAccountId
          ? (accounts.get(row.utilityAccountId) ?? null)
          : null,
        previousMeterId: row.previousMeterId ? (copies.get(row.previousMeterId) ?? null) : null,
      })
      .returning();
    if (!copy) deny();
    copies.set(row.id, copy.id);
    for (const reading of await tx
      .select()
      .from(meterReadings)
      .where(and(eq(meterReadings.parentId, row.id), isNull(meterReadings.deletedAt)))
      .orderBy(meterReadings.occurredOn, meterReadings.id)) {
      if (!canView(account.viewer, placementOf(reading))) continue;
      const [duplicate] = await tx
        .insert(meterReadings)
        .values({
          ...columnsOf(placementOf(target)),
          parentId: copy.id,
          authorId: account.id,
          title: reading.title,
          occurredOn: reading.occurredOn,
          values: reading.values,
          consumption: reading.consumption,
          rollover: reading.rollover,
          comment: reading.comment,
          transmittedAt: reading.transmittedAt,
          transmissionMethod: reading.transmissionMethod,
        })
        .returning();
      if (!duplicate) deny();
      const links = await tx
        .select()
        .from(recordLinks)
        .where(
          and(
            eq(recordLinks.leftTable, 'meter_readings'),
            eq(recordLinks.leftId, reading.id),
            eq(recordLinks.rightTable, 'object_files'),
            eq(recordLinks.role, 'reading_photo'),
            isNull(recordLinks.deletedAt),
          ),
        );
      for (const link of links) {
        const file = files.get(link.rightId);
        if (file)
          await tx.insert(recordLinks).values({
            leftTable: 'meter_readings',
            leftId: duplicate.id,
            rightTable: 'object_files',
            rightId: file,
            role: 'reading_photo',
            authorId: account.id,
          });
      }
    }
  }
}
