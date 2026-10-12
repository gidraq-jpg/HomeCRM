import { randomUUID } from 'node:crypto';
import { canView, canWriteDeadline, DeadlineRule, type RecordFacts } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { deadlines, sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
const family = buildFamily();
const cases: { id: string; actionId: string; facts: RecordFacts }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  await db.worker.query(
    "UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE kind='household' AND time_zone IS NULL",
  );
  for (const table of ['notes', 'objects'] as const)
    for (const place of family.placements) {
      const author =
        place.kind === 'personal'
          ? family.people.find((p) => p.id === place.ownerId)
          : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin');
      if (!author?.viewer.memberships.size) continue;
      const sourceId = randomUUID(),
        id = randomUUID(),
        cols = placementColumns(place);
      await db.admin.query(
        `INSERT INTO ${table}(id,space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,$5,'Вымышленный источник матрицы')`,
        [sourceId, place.spaceId, place.kind, cols.audience, author.id],
      );
      await createAppDatabase(db.app).withAccount(author.id, (tx) =>
        tx.insert(deadlines).values({
          id,
          noteId: table === 'notes' ? sourceId : null,
          objectId: table === 'objects' ? sourceId : null,
          householdId:
            place.kind === 'household'
              ? place.spaceId
              : ([...author.viewer.memberships.keys()][0] ?? ''),
          rule: DeadlineRule.parse({ kind: 'date', date: '2026-10-10' }),
          ...cols,
          authorId: author.id,
          assigneeId: author.id,
        }),
      );
      await db.worker.query(
        `INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id) VALUES($1,'2026-10-10','2026-10-09T19:00Z','2026-10-10T18:59:59Z','Asia/Yekaterinburg','[]',$2,$3,$4,$5,$5)`,
        [id, place.spaceId, place.kind, cols.audience, author.id],
      );
      await db.worker.query('UPDATE deadlines SET needs_refresh=false WHERE id=$1', [id]);
      const action = await createAppDatabase(db.app).withAccount(author.id, (tx) =>
        tx.execute<{ id: string }>(
          sql`INSERT INTO radar_actions(deadline_id,calendar_key,date,status,reason,actor_id,space_id,space_kind,audience,author_id,assignee_id) SELECT id,app.radar_calendar_key(rule),'2026-10-10','dismissed','Вымышленная причина матрицы',${author.id}::uuid,space_id,space_kind,audience,author_id,assignee_id FROM deadlines WHERE id=${id}::uuid RETURNING id`,
        ),
      );
      cases.push({
        id,
        actionId: action.rows[0]?.id ?? '',
        facts: {
          type: table === 'notes' ? 'note' : 'object',
          placement: place,
          authorId: author.id,
          assigneeId: author.id,
        },
      });
    }
  for (const house of family.houses)
    for (const person of family.people) {
      await db.worker.query(
        `INSERT INTO summaries(account_id,household_id,time_zone,kind,local_date,period_start,period_end) VALUES($1,$2,'Asia/Yekaterinburg','morning','2026-10-11','2026-10-10T03:00Z','2026-10-11T03:00Z')`,
        [person.id, house.id],
      );
    }
});
afterAll(async () => db?.drop());
it('RLS: причины, количества, история и право правки совпадают с общим эталоном участников × мест', async () => {
  let checks = 0;
  for (const person of family.people) {
    const rows = await createAppDatabase(db.app).withAccount(person.id, (tx) =>
      tx.execute<{ id: string; reason: string }>(sql`SELECT id,reason FROM radar_actions`),
    );
    expect(new Set(rows.rows.map((r) => r.id))).toEqual(
      new Set(
        cases.filter((c) => canView(person.viewer, c.facts.placement)).map((c) => c.actionId),
      ),
    );
    for (const c of cases) {
      const client = await db.app.connect();
      let allowed = false;
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.account_id',$1,true)", [person.id]);
        const result = await client.query(
          "UPDATE radar_actions SET status='active',reason=NULL,version=version+1 WHERE id=$1 RETURNING history",
          [c.actionId],
        );
        allowed = result.rowCount === 1;
        if (allowed) expect(result.rows[0].history).toHaveLength(1);
      } catch (error) {
        if (!hasCode(error, ['42501'])) throw error;
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
      expect(allowed, `${person.key} ${c.facts.type}`).toBe(
        canWriteDeadline(person.viewer, c.facts),
      );
      checks++;
    }
  }
  console.info(`Radar actions matrix: ${checks} checks`);
  expect(checks).toBeGreaterThan(90);
});
it('сводки видит только получатель с действующим членством; worker не читает названия/причины/историю', async () => {
  for (const person of family.people) {
    const rows = await createAppDatabase(db.app).withAccount(person.id, (tx) =>
      tx.execute<{ account_id: string; household_id: string }>(
        sql`SELECT account_id,household_id FROM summaries`,
      ),
    );
    expect(
      rows.rows.every(
        (r) => r.account_id === person.id && person.viewer.memberships.has(r.household_id),
      ),
    ).toBe(true);
    expect(rows.rowCount).toBe(person.viewer.memberships.size);
  }
  for (const statement of [
    'SELECT reason FROM radar_actions',
    'SELECT history FROM radar_actions',
    'SELECT title FROM tasks',
    'SELECT title FROM documents',
    'SELECT cancellation_reason FROM utility_payments',
  ])
    await expect(db.worker.query(statement)).rejects.toThrow();
  expect((await db.worker.query('SELECT status,snoozed_until FROM radar_actions')).rowCount).toBe(
    cases.length,
  );
  expect(
    (
      await db.admin.query(
        "SELECT relrowsecurity AND relforcerowsecurity AS protected FROM pg_class WHERE relname IN ('radar_actions','summaries')",
      )
    ).rows,
  ).toEqual([{ protected: true }, { protected: true }]);
});
