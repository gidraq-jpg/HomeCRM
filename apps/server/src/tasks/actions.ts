import { randomUUID } from 'node:crypto';
import { deadlines, eq, objects, sql, tasks } from '@homecrm/db';
import { canRestore, canTrash } from '@homecrm/shared';
import { z } from 'zod';
import { readRadar } from '../deadlines/routes.ts';
import { getObject } from '../objects/routes.ts';
import { type DataRoute, deny, Failure, factsOf, parse, requireWrite } from '../objects/support.ts';
import { publicRecord } from '../utilities/service.ts';
import { getTask, summaries, summary } from './routes.ts';
export function taskActions(route: DataRoute) {
  route('POST', '/api/objects/:id/assignee', 200, async (tx, account, request) => {
    const { id } = parse(z.strictObject({ id: z.uuid() }), request.params),
      { assigneeId } = parse(z.strictObject({ assigneeId: z.uuid() }), request.body);
    const row = await getObject(tx, account, id, true);
    requireWrite(account, row, 'object');
    const visible = (
      await tx.execute<{ visible: boolean }>(
        sql`SELECT app.record_notification_visible('objects',${id}::uuid,${assigneeId}::uuid) AS visible`,
      )
    ).rows[0]?.visible;
    if (!visible) throw new Failure(409, 'ASSIGNEE_NOT_VISIBLE');
    const [result] = await tx
      .update(objects)
      .set({ assigneeId })
      .where(eq(objects.id, id))
      .returning();
    if (!result) deny();
    return publicRecord(result);
  });
  route('POST', '/api/deadlines/:id/assignee', 200, async (tx, _account, request) => {
    const { id } = parse(z.strictObject({ id: z.uuid() }), request.params),
      { assigneeId } = parse(z.strictObject({ assigneeId: z.uuid() }), request.body);
    const [row] = await tx.select().from(deadlines).where(eq(deadlines.id, id)).for('update');
    if (!row || row.deletedAt) throw new Failure(404, 'NOT_FOUND');
    if (row.sourceKind !== 'record') throw new Failure(409, 'EDIT_SOURCE');
    const visible = (
      await tx.execute<{ visible: boolean }>(
        sql`SELECT app.record_notification_visible('deadlines',${id}::uuid,${assigneeId}::uuid) AS visible`,
      )
    ).rows[0]?.visible;
    if (!visible) throw new Failure(409, 'ASSIGNEE_NOT_VISIBLE');
    const [result] = await tx
      .update(deadlines)
      .set({ assigneeId, assigneeOverrideId: assigneeId })
      .where(eq(deadlines.id, id))
      .returning();
    if (!result) deny();
    return result;
  });
  route('POST', '/api/tasks/:id/undo', 200, async (tx, account, request) => {
    const { id } = parse(z.strictObject({ id: z.uuid() }), request.params),
      { eventId } = parse(z.strictObject({ eventId: z.uuid() }), request.body);
    const row = await getTask(tx, account, id, true);
    requireWrite(account, row, 'task');
    if (row.completionEventId !== eventId) throw new Failure(409, 'COMPLETION_CHANGED');
    if (row.completionUndoneAt) return summary(tx, row);
    const [result] = await tx
      .update(tasks)
      .set({
        status: row.completionPreviousStatus === 'waiting' ? 'waiting' : 'open',
        doneAt: null,
        completionUndoneAt: sql`clock_timestamp()`,
      })
      .where(eq(tasks.id, id))
      .returning();
    if (!result) deny();
    return summary(tx, result);
  });
  route('POST', '/api/tasks/:id/main', 200, async (tx, account, request) => {
    const { id } = parse(z.strictObject({ id: z.uuid() }), request.params),
      { selected } = parse(z.strictObject({ selected: z.boolean() }), request.body);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-main:${account.id}`}::text,0))`,
    );
    const row = await getTask(tx, account, id, true);
    requireWrite(account, row, 'task');
    if (row.assigneeId !== account.id || !['open', 'waiting'].includes(row.status)) deny();
    if (selected)
      await tx
        .update(tasks)
        .set({ isMain: false })
        .where(sql`assignee_id=${account.id}::uuid AND is_main AND deleted_at IS NULL`);
    const [result] = await tx
      .update(tasks)
      .set({ isMain: selected })
      .where(eq(tasks.id, id))
      .returning();
    if (!result) deny();
    return summary(tx, result);
  });
  for (const action of ['trash', 'restore'] as const)
    route('POST', `/api/tasks/:id/series/${action}`, 200, async (tx, account, request) => {
      parse(z.strictObject({}), request.body ?? {});
      const { id } = parse(z.strictObject({ id: z.uuid() }), request.params);
      const row = await getTask(tx, account, id);
      if (!row.seriesId) throw new Failure(409, 'NOT_A_SERIES');
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${row.seriesId}::text,0))`,
      );
      if (action === 'restore' && !row.seriesTrashKey) throw new Failure(409, 'NOT_SERIES_TRASH');
      const rows = await tx
        .select()
        .from(tasks)
        .where(
          sql`series_id=${row.seriesId}::uuid AND (${action}='trash' OR series_trash_key=${row.seriesTrashKey}::uuid)`,
        )
        .orderBy(tasks.id)
        .for('update');
      for (const item of rows)
        if (!(action === 'trash' ? canTrash : canRestore)(account.viewer, factsOf(item, 'task')))
          deny();
      if (
        action === 'restore' &&
        rows.filter((r) => ['open', 'waiting'].includes(r.status)).length > 1
      )
        throw new Failure(409, 'SERIES_CHANGED');
      const result = [],
        trashKey = randomUUID();
      for (const item of rows) {
        if (!!item.deletedAt === (action === 'trash')) {
          result.push(item);
          continue;
        }
        const [changed] = await tx
          .update(tasks)
          .set({
            deletedAt: action === 'trash' ? new Date() : null,
            ...(action === 'trash' ? { seriesTrashKey: trashKey } : {}),
          })
          .where(eq(tasks.id, item.id))
          .returning();
        if (!changed) deny();
        result.push(changed);
      }
      return summaries(tx, result);
    });
  route('POST', '/api/tasks/from-radar', 201, async (tx, account, request) => {
    const { occurrenceId } = parse(z.strictObject({ occurrenceId: z.uuid() }), request.body);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${occurrenceId}::text,0))`);
    const [prior] = await tx.select().from(tasks).where(eq(tasks.radarOccurrenceId, occurrenceId));
    if (prior) return summary(tx, prior);
    const source = (
      await tx.execute<{
        space_id: string;
        space_kind: 'personal' | 'household';
        audience: 'household' | 'adults' | null;
        household_id: string;
        date: string;
        title: string;
        task_id: string | null;
        note_id: string | null;
        object_id: string | null;
        document_id: string | null;
        contact_id: string | null;
      }>(sql`
   SELECT d.space_id,d.space_kind,d.audience,d.household_id,o.date::text,coalesce(d.label,n.title,b.title,doc.title,t.title,c.title,p.display_name) AS title,d.task_id,d.note_id,d.object_id,d.document_id,d.contact_id
   FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id LEFT JOIN notes n ON n.id=d.note_id LEFT JOIN objects b ON b.id=d.object_id LEFT JOIN documents doc ON doc.id=d.document_id LEFT JOIN tasks t ON t.id=d.task_id LEFT JOIN contacts c ON c.id=d.contact_id LEFT JOIN member_profiles p ON p.account_id=d.profile_account_id
   WHERE o.id=${occurrenceId}::uuid AND o.deleted_at IS NULL AND (o.completed_at IS NULL OR d.source_kind='readings') AND d.deleted_at IS NULL`)
    ).rows[0];
    if (
      !source?.title ||
      !(await readRadar(tx, '0001-01-01', source.date)).items.some((i) => i.id === occurrenceId)
    )
      throw new Failure(404, 'NOT_FOUND');
    if (source.task_id) return summary(tx, await getTask(tx, account, source.task_id));
    const [row] = await tx
      .insert(tasks)
      .values({
        title: source.title,
        spaceId: source.space_id,
        spaceKind: source.space_kind,
        audience: source.audience,
        authorId: account.id,
        assigneeId: account.id,
        householdId: source.household_id,
        planOn: source.date,
        radarOccurrenceId: occurrenceId,
      })
      .returning();
    if (!row) deny();
    const table = source.task_id
      ? 'tasks'
      : source.document_id
        ? 'documents'
        : source.object_id
          ? 'objects'
          : source.note_id
            ? 'notes'
            : source.contact_id
              ? 'contacts'
              : null;
    const sourceId =
      source.task_id ??
      source.document_id ??
      source.object_id ??
      source.note_id ??
      source.contact_id;
    if (table && sourceId)
      await tx.execute(
        sql`INSERT INTO record_links(left_table,left_id,right_table,right_id,role,author_id) VALUES('tasks',${row.id}::uuid,${table},${sourceId}::uuid,'Источник радара',${account.id}::uuid)`,
      );
    return summary(tx, row);
  });
}
