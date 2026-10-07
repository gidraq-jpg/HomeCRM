import { randomUUID } from 'node:crypto';
import {
  canRestore,
  canView,
  canViewDeadline,
  canWriteDeadline,
  DeadlineRule,
  type RecordFacts,
} from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { deadlines, eq, sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
const family = buildFamily();
const examples: {
  id: string;
  sourceId: string;
  table: 'notes' | 'objects';
  facts: RecordFacts;
  occurrenceId: string;
}[] = [];
const rule = DeadlineRule.parse({ kind: 'date', date: '2026-10-10', warnings: [3] });
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  await db.worker.query(
    "UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE kind='household' AND time_zone IS NULL",
  );
  const app = createAppDatabase(db.app);
  for (const table of ['notes', 'objects'] as const)
    for (const place of family.placements) {
      const author =
        place.kind === 'personal'
          ? family.people.find((p) => p.id === place.ownerId)
          : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin');
      if (!author || author.viewer.memberships.size === 0) continue;
      const id = randomUUID(),
        sourceId = randomUUID(),
        occurrenceId = randomUUID();
      const columns = placementColumns(place);
      await db.admin.query(
        `INSERT INTO ${table}(id,space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,$5,'Вымышленный источник')`,
        [sourceId, place.spaceId, place.kind, columns.audience, author.id],
      );
      const house =
        place.kind === 'household' ? place.spaceId : [...author.viewer.memberships.keys()][0];
      await app.withAccount(author.id, (tx) =>
        tx.insert(deadlines).values({
          id,
          noteId: table === 'notes' ? sourceId : null,
          objectId: table === 'objects' ? sourceId : null,
          householdId: house ?? '',
          rule,
          ...columns,
          authorId: author.id,
          assigneeId: author.id,
        }),
      );
      await db.worker.query(
        `INSERT INTO deadline_occurrences(id,deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,audience,author_id,assignee_id)
      VALUES($1,$2,'2026-10-10','2026-10-09T19:00:00Z','2026-10-10T18:59:59Z','Asia/Yekaterinburg','[]',$3,$4,$5,$6,$6)`,
        [occurrenceId, id, place.spaceId, place.kind, columns.audience, author.id],
      );
      await db.worker.query('UPDATE deadlines SET needs_refresh=false WHERE id=$1', [id]);
      await db.worker.query(
        "INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at) VALUES($1,$2,'2026-10-07T04:00:00Z')",
        [occurrenceId, author.id],
      );
      examples.push({
        id,
        sourceId,
        table,
        occurrenceId,
        facts: {
          placement: place,
          type: table === 'notes' ? 'note' : 'object',
          authorId: author.id,
          assigneeId: author.id,
        },
      });
    }
});
afterAll(async () => {
  await db?.drop();
});
it('матрица: чтение правил, наступлений и счётчиков совпадает с эталоном для всех участников и мест', async () => {
  let checks = 0;
  for (const person of family.people)
    await createAppDatabase(db.app).withAccount(person.id, async (tx) => {
      const rules = await tx.execute<{ id: string }>(sql`SELECT id FROM deadlines`);
      const occurrences = await tx.execute<{ id: string }>(
        sql`SELECT id FROM deadline_occurrences`,
      );
      const count = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int n FROM deadline_occurrences`,
      );
      const notifications = await tx.execute<{ occurrence_id: string }>(
        sql`SELECT occurrence_id FROM deadline_notifications`,
      );
      const visible = examples.filter((x) => canView(person.viewer, x.facts.placement));
      expect(new Set(rules.rows.map((x) => x.id))).toEqual(new Set(visible.map((x) => x.id)));
      expect(new Set(occurrences.rows.map((x) => x.id))).toEqual(
        new Set(visible.map((x) => x.occurrenceId)),
      );
      expect(count.rows[0]?.n).toBe(visible.length);
      expect(new Set(notifications.rows.map((x) => x.occurrence_id))).toEqual(
        new Set(visible.filter((x) => x.facts.assigneeId === person.id).map((x) => x.occurrenceId)),
      );
      for (const example of examples) {
        const found = await tx
          .select({ id: deadlines.id })
          .from(deadlines)
          .where(eq(deadlines.id, example.id));
        expect(found.length === 1).toBe(canView(person.viewer, example.facts.placement));
        checks++;
      }
    });
  expect(checks).toBeGreaterThan(90);
});
it('матрица: источник в корзине сохраняет доступ к правилу и названию, но не к наступлениям; restore совпадает с эталоном', async () => {
  for (const example of examples) {
    for (const trashSource of [true, false]) {
      const client = await db.app.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.account_id',$1,true)", [example.facts.authorId]);
        if (trashSource)
          await client.query(`UPDATE ${example.table} SET deleted_at=now() WHERE id=$1`, [
            example.sourceId,
          ]);
        else await client.query('UPDATE deadlines SET deleted_at=now() WHERE id=$1', [example.id]);
        for (const person of family.people) {
          await client.query("SELECT set_config('app.account_id',$1,true)", [person.id]);
          const rows = await client.query(
            `SELECT d.id,p.title FROM deadlines d JOIN ${example.table} p ON p.id=coalesce(d.note_id,d.object_id) WHERE d.id=$1`,
            [example.id],
          );
          expect(rows.rowCount === 1).toBe(
            canViewDeadline(person.viewer, { ...example.facts, trashed: trashSource }),
          );
          expect(rows.rows.every((x) => x.title === 'Вымышленный источник')).toBe(true);
          expect(
            (
              await client.query('SELECT id FROM deadline_occurrences WHERE deadline_id=$1', [
                example.id,
              ])
            ).rowCount,
          ).toBe(0);
          if (!trashSource) {
            await client.query('SAVEPOINT restore_check');
            let allowed = false;
            try {
              allowed =
                (
                  await client.query(
                    'UPDATE deadlines SET deleted_at=NULL WHERE id=$1 RETURNING id',
                    [example.id],
                  )
                ).rowCount === 1;
            } catch (error) {
              if (!hasCode(error, ['42501'])) throw error;
            } finally {
              await client.query('ROLLBACK TO SAVEPOINT restore_check');
            }
            expect(allowed, `${person.name} restore ${example.table}`).toBe(
              canRestore(person.viewer, example.facts),
            );
          }
        }
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  }
});
it('матрица: создание, правка и корзина разрешены только редактору источника', async () => {
  for (const person of family.people)
    for (const example of examples)
      for (const operation of ['create', 'edit', 'trash'] as const) {
        const client = await db.app.connect();
        let allowed = false;
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.account_id',$1,true)", [person.id]);
          if (operation === 'create') {
            const house =
              example.facts.placement.kind === 'household'
                ? example.facts.placement.spaceId
                : [
                    ...(family.people
                      .find((p) => p.id === example.facts.authorId)
                      ?.viewer.memberships.keys() ?? []),
                  ][0];
            const result = await client.query(
              `INSERT INTO deadlines(note_id,object_id,household_id,rule,space_id,space_kind,audience,author_id,assignee_id) SELECT note_id,object_id,$2,rule,space_id,space_kind,audience,$3,assignee_id FROM deadlines WHERE id=$1 RETURNING id`,
              [example.id, house, person.id],
            );
            allowed = result.rowCount === 1;
          } else {
            const result = await client.query(
              `UPDATE deadlines SET ${operation === 'edit' ? 'rule=rule' : 'deleted_at=now()'} WHERE id=$1 RETURNING id`,
              [example.id],
            );
            allowed = result.rowCount === 1;
          }
        } catch (error) {
          if (!hasCode(error, ['42501'])) throw error;
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        expect(allowed, `${person.name} ${operation} ${example.table}`).toBe(
          canWriteDeadline(person.viewer, example.facts),
        );
      }
});
it('перенос общего источника в личное сразу скрывает правила и наступления у остальных; метаданные следуют за родителем', async () => {
  const example = examples.find(
    (x) =>
      x.table === 'notes' &&
      x.facts.placement.kind === 'household' &&
      x.facts.placement.audience === 'household',
  );
  if (!example) throw new Error('Missing fixture');
  const anna = family.person('anna');
  await createAppDatabase(db.app).withAccount(anna.id, (tx) =>
    tx.execute(
      sql`UPDATE notes SET space_id=${anna.personalSpaceId},space_kind='personal',audience=NULL WHERE id=${example.sourceId}`,
    ),
  );
  const meta = await db.admin.query(
    'SELECT space_id,space_kind,audience FROM deadline_occurrences WHERE deadline_id=$1',
    [example.id],
  );
  expect(meta.rows[0]).toMatchObject({
    space_id: anna.personalSpaceId,
    space_kind: 'personal',
    audience: null,
  });
  await createAppDatabase(db.app).withAccount(family.person('boris').id, async (tx) => {
    expect((await tx.execute(sql`SELECT id FROM deadlines WHERE id=${example.id}`)).rowCount).toBe(
      0,
    );
    expect(
      (await tx.execute(sql`SELECT id FROM deadline_occurrences WHERE deadline_id=${example.id}`))
        .rowCount,
    ).toBe(0);
  });
});
it('корзина и восстановление источника каскадны; отдельно удалённое правило не восстанавливается', async () => {
  const example = examples.find(
    (x) =>
      x.table === 'objects' &&
      x.facts.placement.kind === 'personal' &&
      x.facts.authorId === family.person('boris').id,
  );
  if (!example) throw new Error('Missing fixture');
  const app = createAppDatabase(db.app),
    boris = family.person('boris');
  await app.withAccount(boris.id, (tx) =>
    tx.execute(sql`UPDATE objects SET deleted_at=now() WHERE id=${example.sourceId}`),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM deadlines WHERE id=$1', [example.id])).rows[0]
      .deleted_at,
  ).not.toBeNull();
  await app.withAccount(boris.id, (tx) =>
    tx.execute(sql`UPDATE objects SET deleted_at=NULL WHERE id=${example.sourceId}`),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM deadlines WHERE id=$1', [example.id])).rows[0]
      .deleted_at,
  ).toBeNull();
  await app.withAccount(boris.id, (tx) =>
    tx.execute(sql`UPDATE deadlines SET deleted_at=now() WHERE id=${example.id}`),
  );
  await app.withAccount(boris.id, (tx) =>
    tx.execute(sql`UPDATE objects SET deleted_at=now() WHERE id=${example.sourceId}`),
  );
  await app.withAccount(boris.id, (tx) =>
    tx.execute(sql`UPDATE objects SET deleted_at=NULL WHERE id=${example.sourceId}`),
  );
  expect(
    (await db.admin.query('SELECT deleted_at FROM deadlines WHERE id=$1', [example.id])).rows[0]
      .deleted_at,
  ).not.toBeNull();
});
it('worker не меняет правила, не читает тексты; приложение не меняет производные даты и не удаляет мимо корзины', async () => {
  for (const text of [
    'SELECT title FROM notes',
    'SELECT body FROM notes',
    'SELECT title FROM objects',
    "UPDATE deadlines SET rule='{}'",
  ])
    await expect(db.worker.query(text)).rejects.toMatchObject({ code: '42501' });
  expect((await db.worker.query('DELETE FROM deadlines')).rowCount).toBe(0);
  for (const text of [
    'DELETE FROM deadlines',
    'INSERT INTO deadline_occurrences DEFAULT VALUES',
    'UPDATE deadline_occurrences SET starts_at=now()',
  ])
    await expect(db.app.query(text)).rejects.toMatchObject({ code: '42501' });
  const example = examples[1];
  if (!example) throw new Error('Missing fixture');
  await expect(
    createAppDatabase(db.app).withAccount(example.facts.authorId, (tx) =>
      tx.execute(
        sql`UPDATE deadlines SET space_id=${family.person('gleb').personalSpaceId} WHERE id=${example.id}`,
      ),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['42501']));
});
it('worker сохраняет 29 дней корзины, удаляет 31 день с потомками; очистка источника удаляет его сроки', async () => {
  const person = family.person('boris');
  const app = createAppDatabase(db.app);
  async function fixture() {
    const sourceId = randomUUID(),
      id = randomUUID(),
      occurrenceId = randomUUID();
    await db.admin.query(
      "INSERT INTO notes(id,space_id,space_kind,author_id,title) VALUES($1,$2,'personal',$3,'Вымышленная корзина')",
      [sourceId, person.personalSpaceId, person.id],
    );
    await app.withAccount(person.id, (tx) =>
      tx.insert(deadlines).values({
        id,
        noteId: sourceId,
        householdId: [...person.viewer.memberships.keys()][0] ?? '',
        rule,
        spaceId: person.personalSpaceId,
        spaceKind: 'personal',
        authorId: person.id,
        assigneeId: person.id,
      }),
    );
    await db.worker.query(
      `INSERT INTO deadline_occurrences(id,deadline_id,date,starts_at,ends_at,time_zone,warnings_at,space_id,space_kind,author_id,assignee_id)
       VALUES($1,$2,'2026-10-10','2026-10-09T19:00:00Z','2026-10-10T18:59:59Z','Asia/Yekaterinburg','[]',$3,'personal',$4,$4)`,
      [occurrenceId, id, person.personalSpaceId, person.id],
    );
    await db.worker.query(
      'INSERT INTO deadline_notifications(occurrence_id,recipient_id,warning_at) VALUES($1,$2,now())',
      [occurrenceId, person.id],
    );
    return { sourceId, id, occurrenceId };
  }
  const recent = await fixture(),
    expired = await fixture(),
    source = await fixture();
  for (const item of [recent, expired])
    await app.withAccount(person.id, (tx) =>
      tx.execute(sql`UPDATE deadlines SET deleted_at=now() WHERE id=${item.id}`),
    );
  // Только вымышленная тестовая база: моделируем прошедшее время без ожидания 31 дня.
  await db.admin.query('ALTER TABLE deadlines DISABLE TRIGGER deadlines_guard');
  try {
    await db.admin.query("UPDATE deadlines SET deleted_at=now()-interval '29 days' WHERE id=$1", [
      recent.id,
    ]);
    await db.admin.query("UPDATE deadlines SET deleted_at=now()-interval '31 days' WHERE id=$1", [
      expired.id,
    ]);
  } finally {
    await db.admin.query('ALTER TABLE deadlines ENABLE TRIGGER deadlines_guard');
  }
  await db.worker.query('DELETE FROM deadlines');
  expect((await db.admin.query('SELECT id FROM deadlines WHERE id=$1', [recent.id])).rowCount).toBe(
    1,
  );
  expect(
    (await db.admin.query('SELECT id FROM deadline_occurrences WHERE id=$1', [recent.occurrenceId]))
      .rowCount,
  ).toBe(1);
  expect(
    (
      await db.admin.query('SELECT id FROM deadline_notifications WHERE occurrence_id=$1', [
        recent.occurrenceId,
      ])
    ).rowCount,
  ).toBe(1);
  async function gone(item: typeof source) {
    expect((await db.admin.query('SELECT id FROM deadlines WHERE id=$1', [item.id])).rowCount).toBe(
      0,
    );
    expect(
      (await db.admin.query('SELECT id FROM deadline_occurrences WHERE id=$1', [item.occurrenceId]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await db.admin.query('SELECT id FROM deadline_notifications WHERE occurrence_id=$1', [
          item.occurrenceId,
        ])
      ).rowCount,
    ).toBe(0);
  }
  await gone(expired);
  await db.admin.query('ALTER TABLE notes DISABLE TRIGGER notes_trash_time');
  try {
    await db.admin.query("UPDATE notes SET deleted_at=now()-interval '31 days' WHERE id=$1", [
      source.sourceId,
    ]);
  } finally {
    await db.admin.query('ALTER TABLE notes ENABLE TRIGGER notes_trash_time');
  }
  expect((await db.worker.query('DELETE FROM notes WHERE id=$1', [source.sourceId])).rowCount).toBe(
    1,
  );
  await gone(source);
});
it('уход из дома не скрывает собственный личный срок и его наступление', async () => {
  const person = family.person('boris');
  const item = examples.find(
    (x) =>
      x.table === 'notes' &&
      x.facts.placement.kind === 'personal' &&
      x.facts.authorId === person.id,
  );
  if (!item) throw new Error('Missing fixture');
  await db.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE account_id=$1',
    [person.id],
  );
  await createAppDatabase(db.app).withAccount(person.id, async (tx) => {
    expect((await tx.execute(sql`SELECT id FROM deadlines WHERE id=${item.id}`)).rowCount).toBe(1);
    expect(
      (await tx.execute(sql`SELECT id FROM deadline_occurrences WHERE id=${item.occurrenceId}`))
        .rowCount,
    ).toBe(1);
  });
});
