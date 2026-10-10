import { randomUUID } from 'node:crypto';
import { canViewDeadline, type RecordFacts } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';
import { isDenied } from './testing/matrix.ts';

const family = buildFamily();
const sources: { id: string; facts: RecordFacts }[] = [];
let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  for (const place of family.placements) {
    const author =
      place.kind === 'personal'
        ? place.ownerId
        : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin')?.id;
    if (!author) throw new Error('Missing fictional author');
    const columns = placementColumns(place),
      id = randomUUID();
    await db.admin.query(
      `INSERT INTO tasks(id,space_id,space_kind,audience,author_id,title,household_id,plan_on,due_on,status,waiting_account_id,check_on)
      VALUES($1,$2,$3,$4,$5,'Дело матрицы',$6,'2026-10-10','2026-10-11','waiting',$5,'2026-10-12')`,
      [
        id,
        columns.spaceId,
        columns.spaceKind,
        columns.audience,
        author,
        place.kind === 'household' ? place.spaceId : family.houses[0]?.id,
      ],
    );
    sources.push({
      id,
      facts: { placement: place, type: 'task', authorId: author, assigneeId: author },
    });
  }
  await db.admin.query(`INSERT INTO deadline_occurrences(deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id)
    SELECT id,(rule->>'date')::date,'2026-10-10T04:00Z','2026-10-10T18:59Z','Asia/Yekaterinburg','[]',space_id,space_kind,audience,author_id,assignee_id FROM deadlines WHERE task_id IS NOT NULL`);
});
afterAll(async () => {
  await db?.drop();
});
it('TASK-1/8: 180 чтений правил и наступлений совпадают с access.ts, включая чужой дом и личное администратора', async () => {
  const app = createAppDatabase(db.app);
  for (const viewer of family.people)
    for (const source of sources) {
      const visible = canViewDeadline(viewer.viewer, source.facts);
      const result = await app.withAccount(viewer.id, async (tx) => ({
        rules: (
          await tx.execute(sql`SELECT source_kind FROM deadlines WHERE task_id=${source.id}::uuid`)
        ).rows,
        occurrences: (
          await tx.execute(
            sql`SELECT o.id FROM deadline_occurrences o JOIN deadlines d ON d.id=o.deadline_id WHERE d.task_id=${source.id}::uuid`,
          )
        ).rows,
      }));
      expect(result.rules, `${viewer.name}:${source.id}`).toHaveLength(visible ? 3 : 0);
      expect(result.occurrences, `${viewer.name}:${source.id}`).toHaveLength(visible ? 3 : 0);
    }
});
it('TASK-1/8: прямые правка, создание и снятие корзины производного правила закрыты приложению', async () => {
  const source = sources.find(
    (s) => s.facts.placement.kind === 'personal' && s.facts.authorId === family.person('boris').id,
  );
  if (!source) throw new Error('Missing fictional source');
  const app = createAppDatabase(db.app);
  for (const statement of [
    sql`UPDATE deadlines SET rule='{"kind":"date","date":"2030-01-01"}' WHERE task_id=${source.id}::uuid`,
    sql`UPDATE deadlines SET deleted_at=now() WHERE task_id=${source.id}::uuid`,
    sql`INSERT INTO deadlines(task_id,source_kind,household_id,rule,space_id,space_kind,author_id,assignee_id) VALUES(${source.id}::uuid,'task_plan',${family.houses[0]?.id}::uuid,'{"kind":"date","date":"2030-01-01"}',${family.person('boris').personalSpaceId}::uuid,'personal',${family.person('boris').id}::uuid,${family.person('boris').id}::uuid)`,
  ]) {
    try {
      const result = await app.withAccount(family.person('boris').id, (tx) =>
        tx.execute(statement),
      );
      expect(result.rowCount).toBe(0);
    } catch (error) {
      expect(isDenied(error)).toBe(true);
    }
  }
  await expect(db.worker.query('SELECT title,description FROM tasks')).rejects.toThrow();
});
