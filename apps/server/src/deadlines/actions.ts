import { deadlines, eq, radarActions, sql } from '@homecrm/db';
import {
  CalendarDate,
  calendarInstant,
  localDate,
  RadarActionInput,
  RadarActionState,
} from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createAccountReader } from '../auth/account.ts';
import type { AuthModule } from '../auth/routes.ts';
import { beginOperation, fingerprint, finishOperation } from '../idempotency.ts';
import { Failure } from '../objects/support.ts';
import { readRadar } from './routes.ts';

export async function radarActionRoutes(app: FastifyInstance, options: AuthModule) {
  const current = createAccountReader(options);
  app.post('/api/deadlines/occurrences/:id/action', async (request, reply) => {
    const account = await current(request, reply);
    if (!account) return reply;
    const params = z.strictObject({ id: z.uuid() }).safeParse(request.params);
    const input = RadarActionInput.safeParse(request.body);
    if (!params.success || !input.success) throw new Failure(400, 'INVALID_INPUT');
    const { id } = params.data,
      body = input.data;
    return options.appDb.withAccount(account.id, async (tx) => {
      const hash = fingerprint({ id, body });
      const prior = await beginOperation(tx, account.id, body.idempotencyKey, 'radar_action', hash);
      if (prior) {
        const [state] = await tx
          .select()
          .from(radarActions)
          .where(eq(radarActions.id, prior[0] ?? ''));
        if (!state) throw new Failure(404, 'NOT_FOUND');
        return stateOf(state);
      }
      const [pointer] = (
        await tx.execute<{
          deadline_id: string;
          date: string;
          source_id: string;
          source_table: string;
          source_kind: string;
          profile_account_id: string | null;
        }>(sql`
        SELECT o.deadline_id,o.date::text,d.source_kind,d.profile_account_id,coalesce(d.task_id,d.document_id,d.contact_id,d.note_id,d.object_id) AS source_id,
        CASE WHEN d.task_id IS NOT NULL THEN 'tasks' WHEN d.document_id IS NOT NULL THEN 'documents' WHEN d.contact_id IS NOT NULL THEN 'contacts' WHEN d.note_id IS NOT NULL THEN 'notes' WHEN d.object_id IS NOT NULL THEN 'objects' END AS source_table
        FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE o.id=${id}::uuid`)
      ).rows;
      if (!pointer) throw new Failure(404, 'NOT_FOUND');
      if (
        (
          await tx.execute<{ allowed: boolean }>(
            sql`SELECT app.radar_can_write(${pointer.deadline_id}::uuid) AS allowed`,
          )
        ).rows[0]?.allowed !== true
      )
        throw new Failure(403, 'ACCESS_DENIED');
      // Источник перед правилом: тот же порядок, что у мутаций карточек.
      if (pointer.source_table)
        await tx.execute(
          sql`SELECT id FROM ${sql.identifier(pointer.source_table)} WHERE id=${pointer.source_id}::uuid FOR UPDATE`,
        );
      if (pointer.profile_account_id)
        await tx.execute(
          sql`SELECT account_id FROM member_profiles WHERE account_id=${pointer.profile_account_id}::uuid FOR UPDATE`,
        );
      const deadlineQuery = tx
        .select()
        .from(deadlines)
        .where(eq(deadlines.id, pointer.deadline_id));
      // Управляемое правило нельзя UPDATE читателю: его сериализует блокировка источника.
      const [deadline] = await (pointer.source_kind === 'record'
        ? deadlineQuery.for('update')
        : deadlineQuery);
      if (!deadline || deadline.deletedAt) throw new Failure(404, 'NOT_FOUND');
      const [ability] = (
        await tx.execute<{ allowed: boolean; key: string }>(
          sql`SELECT app.radar_can_write(${deadline.id}::uuid) AS allowed,app.radar_calendar_key(${deadline.rule}::jsonb) AS key`,
        )
      ).rows;
      if (!ability?.allowed) throw new Failure(403, 'ACCESS_DENIED');
      if (deadline.needsRefresh || ability.key !== body.calendarKey)
        throw new Failure(409, 'CALENDAR_CHANGED');
      const radar = await readRadar(tx, '0001-01-01', '9999-12-31', { state: 'all' });
      if (!radar.items.some((x) => x.id === id)) throw new Failure(409, 'SOURCE_CLOSED');
      const [old] = await tx
        .select()
        .from(radarActions)
        .where(
          sql`deadline_id=${deadline.id}::uuid AND calendar_key=${body.calendarKey} AND date=${pointer.date}::date`,
        )
        .for('update');
      if ((old?.version ?? 0) !== body.expectedVersion) throw new Failure(409, 'VERSION_CHANGED');
      if (body.action === 'complete' && deadline.sourceKind !== 'record')
        throw new Failure(409, 'EDIT_SOURCE');
      const snoozedUntil =
        body.action === 'snooze' && body.date && body.time
          ? calendarInstant(
              CalendarDate.parse(body.date),
              radar.items.find((x) => x.id === id)?.timeZone ?? 'UTC',
              body.time,
            )
          : null;
      if (snoozedUntil && snoozedUntil <= new Date()) throw new Failure(400, 'SNOOZE_IN_PAST');
      const values = {
        status:
          body.action === 'restore'
            ? 'active'
            : body.action === 'complete'
              ? 'completed'
              : body.action === 'dismiss'
                ? 'dismissed'
                : 'snoozed',
        snoozedUntil,
        reason: body.action === 'dismiss' ? (body.reason ?? null) : null,
        version: (old?.version ?? 0) + 1,
      };
      const [saved] = old
        ? await tx.update(radarActions).set(values).where(eq(radarActions.id, old.id)).returning()
        : await tx
            .insert(radarActions)
            .values({
              ...values,
              deadlineId: deadline.id,
              calendarKey: body.calendarKey,
              date: pointer.date,
              actorId: account.id,
              spaceId: deadline.spaceId,
              spaceKind: deadline.spaceKind,
              audience: deadline.audience,
              authorId: account.id,
              assigneeId: deadline.assigneeId,
            })
            .returning();
      if (!saved) throw new Failure(409, 'CONFLICT');
      if (body.action === 'complete' && deadline.rule.kind === 'after') {
        await tx
          .update(deadlines)
          .set({
            rule: {
              ...deadline.rule,
              eventDate: localDate(
                new Date(),
                radar.items.find((x) => x.id === id)?.timeZone ?? 'UTC',
              ),
            },
          })
          .where(eq(deadlines.id, deadline.id));
      }
      await finishOperation(tx, account.id, body.idempotencyKey, 'radar_action', hash, [saved.id]);
      return stateOf(saved);
    });
  });
}
export function stateOf(state: typeof radarActions.$inferSelect | undefined) {
  return RadarActionState.parse(
    state
      ? {
          version: state.version,
          status: state.status,
          snoozedUntil: state.snoozedUntil?.toISOString() ?? null,
          reason: state.reason,
          actorId: state.actorId,
          changedAt: state.changedAt.toISOString(),
        }
      : {
          version: 0,
          status: 'active',
          snoozedUntil: null,
          reason: null,
          actorId: null,
          changedAt: null,
        },
  );
}
