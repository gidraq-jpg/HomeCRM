import { eq, sql, type Transaction, taskFiles, tasks } from '@homecrm/db';
import { canView } from '@homecrm/shared';
import type { Account } from '../auth/account.ts';
import { fileSummary } from '../files/service.ts';
import { deny, missing, placementOf, requireWrite } from '../records/support.ts';
import { publicRecord } from '../utilities/service.ts';

export type Task = typeof tasks.$inferSelect;
export async function getTask(tx: Transaction, account: Account, id: string, lock = false) {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id));
  if (!row || !canView(account.viewer, placementOf(row))) missing();
  if (!lock) return row;
  if (!row.deletedAt) requireWrite(account, row, 'task');
  if (row.seriesId)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.seriesId}::text,0))`);
  const [locked] = await tx.select().from(tasks).where(eq(tasks.id, id)).for('update');
  if (!locked) deny();
  return locked;
}
export async function summaries(tx: Transaction, rows: Task[]) {
  if (!rows.length) return [];
  const ids = sql`ARRAY[${sql.join(
    rows.map((r) => sql`${r.id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
  const references = (field: 'waitingContactId' | 'waitingAccountId' | 'radarOccurrenceId') =>
    sql`ARRAY[${sql.join(
      [...new Set(rows.flatMap((row) => (row[field] ? [row[field]] : [])))].map(
        (id) => sql`${id}::uuid`,
      ),
      sql`, `,
    )}]::uuid[]`;
  const files = await tx
    .select()
    .from(taskFiles)
    .where(sql`parent_id=ANY(${ids}::uuid[])`)
    .orderBy(taskFiles.createdAt, taskFiles.id);
  const contacts = (
    await tx.execute<{ id: string; title: string }>(
      sql`SELECT id,title FROM contacts WHERE id=ANY(${references('waitingContactId')}) AND deleted_at IS NULL`,
    )
  ).rows;
  const members = (
    await tx.execute<{ id: string; title: string }>(
      sql`SELECT account_id AS id,display_name AS title FROM member_profiles WHERE account_id=ANY(${references('waitingAccountId')})`,
    )
  ).rows;
  const next = (
    await tx.execute<{ id: string; predecessor_id: string }>(
      sql`SELECT id,predecessor_id FROM tasks WHERE predecessor_id=ANY(${ids}::uuid[]) AND deleted_at IS NULL`,
    )
  ).rows;
  const radar = (
    await tx.execute<{ id: string }>(
      sql`SELECT id FROM deadline_occurrences WHERE id=ANY(${references('radarOccurrenceId')}) AND deleted_at IS NULL`,
    )
  ).rows;
  return rows.map((row) => {
    const contact = contacts.find((c) => c.id === row.waitingContactId),
      member = members.find((m) => m.id === row.waitingAccountId);
    return {
      ...publicRecord(row),
      hasOtherContributions:
        row.hasOtherContributions ||
        files.some(
          (file) =>
            file.parentId === row.id &&
            (file.authorId !== row.authorId || file.hasOtherContributions),
        ),
      files: files
        .filter((f) => f.parentId === row.id && (row.deletedAt !== null || f.deletedAt === null))
        .map(fileSummary),
      description: row.description,
      planOn: row.planOn,
      planTime: row.planTime,
      dueOn: row.dueOn,
      dueTime: row.dueTime,
      dueAt: row.dueAt,
      doneAt: row.doneAt,
      status: row.status,
      checklist: row.checklist,
      waitingContactId: contact?.id ?? null,
      waitingAccountId: member?.id ?? null,
      waitingFrom: contact ?? member ?? null,
      checkOn: row.checkOn,
      householdId: row.householdId,
      seriesId: row.seriesId,
      radarOccurrenceId: radar.some((r) => r.id === row.radarOccurrenceId)
        ? row.radarOccurrenceId
        : null,
      repeatRule: row.repeatRule,
      overduePolicy: row.overduePolicy,
      isMain: row.isMain,
      completionEventId: row.completionEventId,
      completionUndoneAt: row.completionUndoneAt,
      nextTaskId: next.find((n) => n.predecessor_id === row.id)?.id ?? null,
    };
  });
}
export async function summary(tx: Transaction, row: Task) {
  return (await summaries(tx, [row]))[0];
}
