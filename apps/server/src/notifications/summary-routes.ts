import { eq, spaces, sql, summaries } from '@homecrm/db';
import { localDate, SummaryMetadata, SummaryResponse, shiftTaskDate } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import { pgError } from '../auth/provision.ts';
import type { AuthModule } from '../auth/routes.ts';
import { readRadar } from '../deadlines/routes.ts';
import { Failure } from '../objects/support.ts';

export async function summaryRoutes(app: FastifyInstance, options: AuthModule) {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof Failure) return reply.code(error.status).send({ code: error.code });
    const { code } = pgError(error);
    app.log.error(
      { databaseCode: /^[A-Z0-9]{5}$/.test(code ?? '') ? code : undefined },
      'Summary request failed',
    );
    return reply.code(500).send({ code: 'INTERNAL_ERROR' });
  });
  const current = createAccountReader(options);
  app.get('/api/summaries', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return reply;
    const q = z.strictObject({ householdId: z.uuid().optional() }).safeParse(request.query);
    if (!q.success) throw new Failure(400, 'INVALID_INPUT');
    if (q.data.householdId && !account.viewer.memberships.has(q.data.householdId))
      throw new Failure(404, 'NOT_FOUND');
    const result = await options.appDb.withAccount(account.id, (tx) =>
      tx
        .select({ metadata: summaries, householdName: spaces.name })
        .from(summaries)
        .innerJoin(spaces, eq(spaces.id, summaries.householdId))
        .where(q.data.householdId ? eq(summaries.householdId, q.data.householdId) : undefined)
        .orderBy(sql`period_end DESC`, summaries.id),
    );
    return z
      .array(SummaryMetadata)
      .parse(
        JSON.parse(
          JSON.stringify(result.map((x) => ({ ...x.metadata, householdName: x.householdName }))),
        ),
      );
  });
  app.get('/api/summaries/:id', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return reply;
    const p = z.strictObject({ id: z.uuid() }).safeParse(request.params);
    if (!p.success) throw new Failure(400, 'INVALID_INPUT');
    return options.appDb.withAccount(account.id, async (tx) => {
      const [row] = await tx
        .select({ metadata: summaries, householdName: spaces.name, currentZone: spaces.timeZone })
        .from(summaries)
        .innerJoin(spaces, eq(spaces.id, summaries.householdId))
        .where(eq(summaries.id, p.data.id));
      if (!row) throw new Failure(404, 'NOT_FOUND');
      const metadata = { ...row.metadata, householdName: row.householdName };
      const today = localDate(new Date(), row.currentZone ?? metadata.timeZone);
      const radar = await readRadar(
        tx,
        '0001-01-01',
        shiftTaskDate(today, metadata.kind === 'weekly' ? 7 : 0),
        { householdId: metadata.householdId, view: 'mine' },
      );
      const done =
        metadata.kind === 'weekly'
          ? (
              await tx.execute<{
                id: string;
                title: string;
                type: 'task' | 'payment' | 'document' | 'deadline';
                at: string;
                href: string;
              }>(sql`
        SELECT t.id,t.title,'task' AS type,t.done_at AS at,'/today/tasks/'||t.id AS href FROM tasks t WHERE t.household_id=${metadata.householdId}::uuid AND t.assignee_id=${account.id}::uuid AND t.deleted_at IS NULL AND t.status='done' AND t.done_at>=${metadata.periodStart.toISOString()}::timestamptz AND t.done_at<${metadata.periodEnd.toISOString()}::timestamptz
        UNION ALL SELECT c.id,c.title,'payment',max(p.created_at),'/home/'||a.parent_id||'/accounts/'||a.id||'/charges' FROM utility_charges c JOIN utility_accounts a ON a.id=c.parent_id JOIN utility_payments p ON p.parent_id=c.id JOIN deadlines d ON d.charge_id=c.id WHERE d.household_id=${metadata.householdId}::uuid AND c.assignee_id=${account.id}::uuid AND c.is_paid AND c.cancelled_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL AND p.cancelled_at IS NULL GROUP BY c.id,a.id,a.parent_id HAVING max(p.created_at)>=${metadata.periodStart.toISOString()}::timestamptz AND max(p.created_at)<${metadata.periodEnd.toISOString()}::timestamptz
        UNION ALL SELECT DISTINCT doc.id,doc.title,'document',doc.invalidated_at,'/documents/'||doc.id FROM documents doc JOIN deadlines d ON d.document_id=doc.id WHERE d.household_id=${metadata.householdId}::uuid AND doc.assignee_id=${account.id}::uuid AND doc.deleted_at IS NULL AND doc.status='invalid' AND doc.invalidated_at>=${metadata.periodStart.toISOString()}::timestamptz AND doc.invalidated_at<${metadata.periodEnd.toISOString()}::timestamptz
        UNION ALL SELECT d.id,coalesce(d.label,n.title,o.title,c.title),'deadline',a.changed_at,CASE WHEN d.note_id IS NOT NULL THEN '/more/notes/'||d.note_id WHEN d.object_id IS NOT NULL THEN '/home/'||d.object_id WHEN d.contact_id IS NOT NULL THEN '/people/contacts/'||d.contact_id END FROM radar_actions a JOIN deadlines d ON d.id=a.deadline_id LEFT JOIN notes n ON n.id=d.note_id LEFT JOIN objects o ON o.id=d.object_id LEFT JOIN contacts c ON c.id=d.contact_id WHERE d.household_id=${metadata.householdId}::uuid AND d.source_kind='record' AND d.deleted_at IS NULL AND d.assignee_id=${account.id}::uuid AND a.status='completed' AND a.changed_at>=${metadata.periodStart.toISOString()}::timestamptz AND a.changed_at<${metadata.periodEnd.toISOString()}::timestamptz
        ORDER BY at,id`)
            ).rows
          : [];
      const deferred = (
        await tx.execute<{ id: string; recordId: string; type: string }>(sql`
        WITH sources AS (
          SELECT id,'tasks' AS tbl,assignee_id,author_id,status,completion_event_id,completion_undone_at FROM tasks WHERE deleted_at IS NULL
          UNION ALL SELECT id,'objects',assignee_id,author_id,'open',NULL::uuid,NULL::timestamptz FROM objects WHERE deleted_at IS NULL
          UNION ALL SELECT id,'documents',assignee_id,author_id,status,NULL::uuid,NULL::timestamptz FROM documents WHERE deleted_at IS NULL
          UNION ALL SELECT id,'deadlines',assignee_id,author_id,'open',NULL::uuid,NULL::timestamptz FROM deadlines WHERE deleted_at IS NULL
        ) SELECT n.id,coalesce(d.task_id,d.document_id,d.note_id,d.object_id,d.contact_id,n.record_id) AS "recordId",
        CASE WHEN d.task_id IS NOT NULL THEN 'task' WHEN d.document_id IS NOT NULL THEN 'document' WHEN d.note_id IS NOT NULL THEN 'note' WHEN d.contact_id IS NOT NULL THEN 'contact' WHEN d.object_id IS NOT NULL THEN 'object' ELSE n.record_table END AS type
        FROM deadline_notifications n LEFT JOIN deadline_occurrences o ON o.id=n.occurrence_id
        LEFT JOIN deadlines d ON d.id=coalesce(o.deadline_id,CASE WHEN n.record_table='deadlines' THEN n.record_id END)
        LEFT JOIN sources src ON src.id=n.record_id AND src.tbl=n.record_table
        LEFT JOIN notification_settings settings ON settings.account_id=n.recipient_id
        WHERE n.summary_id=${metadata.id}::uuid AND n.recipient_id=${account.id}::uuid AND n.status='summary'
        AND coalesce(settings.enabled_kinds,'["deadline","readings_open","readings_closing","readings_last_day","payment_upcoming","payment_due","verification","document","task_reminder","task_assignment","task_done"]'::jsonb) ? CASE WHEN n.record_table='tasks' AND n.event_kind='assignment' THEN 'task_assignment' WHEN n.event_kind='task_done' THEN 'task_done' WHEN n.event_kind='assignment' THEN 'deadline' ELSE n.notification_kind END
        AND ((n.occurrence_id IS NOT NULL AND n.occurrence_id=ANY(${`{${radar.items.map((x) => x.id).join(',')}}`}::uuid[]))
        OR (n.occurrence_id IS NULL AND src.id IS NOT NULL AND
          (n.event_kind='assignment' AND src.assignee_id=${account.id}::uuid AND (src.tbl<>'tasks' OR src.status IN ('open','waiting'))
          OR n.event_kind='task_done' AND src.tbl='tasks' AND src.author_id=${account.id}::uuid AND src.status='done' AND src.completion_undone_at IS NULL AND n.event_key='task_done:'||src.completion_event_id))) ORDER BY n.warning_at,n.id`)
      ).rows;
      return SummaryResponse.parse(
        JSON.parse(
          JSON.stringify({
            metadata,
            done: done
              .filter((x, i, all) => all.findIndex((y) => y.type === x.type && y.id === x.id) === i)
              .map((x) => ({ ...x, at: new Date(x.at).toISOString() })),
            today: uniqueSources(radar.items.filter((x) => x.group === 'now')),
            upcoming: uniqueSources(
              radar.items.filter((x) => x.group === 'now' || x.group === '7days'),
            ),
            stuck: uniqueSources(
              radar.items.filter(
                (x) =>
                  x.group === 'overdue' || (x.sourceKind === 'task_waiting' && x.date <= today),
              ),
            ),
            deferred,
            recalculating: radar.recalculating,
          }),
        ),
      );
    });
  });
}
function uniqueSources<
  T extends {
    id: string;
    taskId: string | null;
    documentId: string | null;
    chargeId: string | null;
  },
>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const key = x.taskId ?? x.documentId ?? x.chargeId ?? x.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
