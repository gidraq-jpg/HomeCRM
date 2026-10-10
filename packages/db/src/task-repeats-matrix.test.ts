import { randomUUID } from 'node:crypto';
import {
  canReceiveRecordNotification,
  canView,
  canViewTaskSeries,
  nextTaskDate,
  type RecordFacts,
  TaskRepeatRule,
} from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
const sources: { id: string; seriesId: string; facts: RecordFacts }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  for (const place of family.placements) {
    const author =
      place.kind === 'personal'
        ? place.ownerId
        : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin')?.id;
    if (!author) throw new Error('Missing author');
    const c = placementColumns(place),
      id = randomUUID();
    const row = (
      await db.admin.query(
        `INSERT INTO tasks(id,space_id,space_kind,audience,author_id,assignee_id,title,household_id,plan_on,repeat_rule) VALUES($1,$2,$3,$4,$5,$5,'Серия матрицы',$6,'2026-10-10','{"kind":"daily"}') RETURNING series_id`,
        [
          id,
          c.spaceId,
          c.spaceKind,
          c.audience,
          author,
          place.kind === 'household' ? place.spaceId : family.houses[0]?.id,
        ],
      )
    ).rows[0];
    sources.push({
      id,
      seriesId: row.series_id,
      facts: { type: 'task', placement: place, authorId: author, assigneeId: author },
    });
  }
});
afterAll(async () => {
  await db?.drop();
});
it('TASK-3/11: чтение серии и проверка адресата совпадают с access.ts во всей матрице', async () => {
  const app = createAppDatabase(db.app);
  for (const viewer of family.people)
    for (const source of sources) {
      const result = await app.withAccount(viewer.id, async (tx) => ({
        series: (
          await tx.execute(
            sql`SELECT DISTINCT series_id FROM tasks WHERE series_id=${source.seriesId}::uuid`,
          )
        ).rowCount,
        visible: (
          await tx.execute<{ visible: boolean }>(
            sql`SELECT app.record_notification_visible('tasks',${source.id}::uuid,${viewer.id}::uuid) AS visible`,
          )
        ).rows[0]?.visible,
      }));
      expect(result.series, viewer.name).toBe(
        canViewTaskSeries(viewer.viewer, source.facts) ? 1 : 0,
      );
      expect(result.visible, viewer.name).toBe(canView(viewer.viewer, source.facts.placement));
      const current = await db.worker.query(
        "SELECT app.record_notification_current('tasks',$1,$2,'assignment','matrix') AS valid",
        [source.id, viewer.id],
      );
      expect(current.rows[0]?.valid, viewer.name).toBe(
        canReceiveRecordNotification(viewer.viewer, source.facts, 'assignment'),
      );
    }
  await expect(
    db.worker.query('SELECT title,description,repeat_template FROM tasks'),
  ).rejects.toThrow();
  await expect(db.app.query('SELECT app.process_task_overdue(now())')).rejects.toThrow();
});
it('TASK-3: SQL и общий календарь совпадают на границах месяца, года и после смены пояса', async () => {
  const rules = [
    { kind: 'daily' },
    { kind: 'weekly', weekdays: [1, 7] },
    { kind: 'monthly', day: 31 },
    { kind: 'monthly', day: 'last' },
    { kind: 'yearly', month: 2, day: 29 },
    { kind: 'every_days', days: 5 },
    { kind: 'after_done', days: 2 },
  ];
  const now = new Date('2026-12-31T22:00:00Z');
  for (const input of rules)
    for (const date of ['2024-02-29', '2026-01-31', '2026-02-28', '2026-12-31'])
      for (const zone of ['UTC', 'Asia/Yekaterinburg', 'America/New_York']) {
        const rule = TaskRepeatRule.parse(input),
          result = await db.worker.query('SELECT app.next_task_date($1,$2,$3,$4)::text AS date', [
            rule,
            date,
            now,
            zone,
          ]);
        expect(result.rows[0]?.date).toBe(nextTaskDate(rule, date, now, zone));
      }
});
