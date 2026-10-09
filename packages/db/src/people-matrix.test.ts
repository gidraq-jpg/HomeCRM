import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canView, canViewInteraction, type Placement, type RecordFacts } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedPeople } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
const events: { id: string; contact: RecordFacts; interaction: RecordFacts; object: Placement }[] =
  [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  const owner = (p: Placement) => {
    if (p.kind === 'personal') return p.ownerId;
    const person = family.people.find((person) => canView(person.viewer, p));
    if (!person) throw new Error('Matrix placement has no owner');
    return person.id;
  };
  for (const contactPlace of family.placements) {
    const contact = randomUUID(),
      author = owner(contactPlace);
    await db.admin.query(
      `INSERT INTO contacts(id,space_id,space_kind,audience,author_id,title,kind)
      VALUES($1,$2,$3,$4,$5,'Контакт матрицы','person')`,
      [
        contact,
        contactPlace.spaceId,
        contactPlace.kind,
        contactPlace.kind === 'household' ? contactPlace.audience : null,
        author,
      ],
    );
    const facts: RecordFacts = {
      type: 'contact',
      placement: contactPlace,
      authorId: author,
      assigneeId: author,
      trashed: false,
    };
    for (const objectPlace of family.placements) {
      const object = randomUUID(),
        id = randomUUID();
      await db.admin.query(
        `INSERT INTO objects(id,space_id,space_kind,audience,author_id,title)
        VALUES($1,$2,$3,$4,$5,'Объект матрицы взаимодействий')`,
        [
          object,
          objectPlace.spaceId,
          objectPlace.kind,
          objectPlace.kind === 'household' ? objectPlace.audience : null,
          owner(objectPlace),
        ],
      );
      await db.admin.query(
        `INSERT INTO contact_interactions(id,parent_id,object_id,space_id,space_kind,audience,author_id,title)
        VALUES($1,$2,$3,$4,$5,$6,$7,'Взаимодействие матрицы')`,
        [
          id,
          contact,
          object,
          contactPlace.spaceId,
          contactPlace.kind,
          contactPlace.kind === 'household' ? contactPlace.audience : null,
          author,
        ],
      );
      events.push({
        id,
        contact: facts,
        interaction: { ...facts, type: 'contact_interaction' },
        object: objectPlace,
      });
    }
  }
});
afterAll(async () => {
  await db?.drop();
});
it('лента объекта: все участники × все сочетания контакта и объекта совпадают с access.ts', async () => {
  const app = createAppDatabase(db.app);
  for (const person of family.people) {
    const expected = events
      .filter(
        (event) =>
          canViewInteraction(person.viewer, event.interaction, event.contact) &&
          canView(person.viewer, event.object),
      )
      .map((event) => event.id)
      .sort();
    const actual = await app.withAccount(
      person.id,
      async (tx) =>
        (
          await tx.execute<{ id: string }>(sql`
      SELECT i.id FROM contact_interactions i JOIN contacts c ON c.id=i.parent_id JOIN objects o ON o.id=i.object_id
      WHERE i.deleted_at IS NULL AND c.deleted_at IS NULL AND o.deleted_at IS NULL`)
        ).rows,
    );
    expect(actual.map((row) => row.id).sort(), person.name).toEqual(expected);
  }
  console.info(
    `People/object access matrix: ${events.length * family.people.length} checks, 0 mismatches`,
  );
});

it('параллельная корзина контакта и взаимодействия не создаёт взаимную блокировку и не позволяет дату задним числом', async () => {
  const event = events[0];
  if (!event) throw new Error('Missing interaction fixture');
  const contact = (
    await db.admin.query('SELECT parent_id FROM contact_interactions WHERE id=$1', [event.id])
  ).rows[0].parent_id as string;
  const parent = await db.app.connect(),
    child = await db.app.connect();
  let updating: Promise<unknown> | undefined;
  try {
    for (const client of [parent, child]) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.account_id',$1,true)", [family.person('anna').id]);
    }
    await child.query('SELECT id FROM contact_interactions WHERE id=$1 FOR UPDATE', [event.id]);
    const pid = (await parent.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number;
    updating = parent.query('UPDATE contacts SET deleted_at=now() WHERE id=$1', [contact]).then(
      () => null,
      (error: unknown) => error,
    );
    const until = Date.now() + 5000;
    let blocked = false;
    while (!blocked && Date.now() < until) {
      blocked = (
        await db.admin.query('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked', [pid])
      ).rows[0].blocked as boolean;
      if (!blocked) await delay(10);
    }
    expect(blocked).toBe(true);
    const result = await child.query(
      `UPDATE contact_interactions SET deleted_at='2000-01-01' WHERE id=$1
      RETURNING deleted_at < now()-interval '30 days' AS expired`,
      [event.id],
    );
    expect(result.rows).toEqual([{ expired: false }]);
    await child.query('ROLLBACK');
    expect(await updating).toBeNull();
    await parent.query('COMMIT');
    expect(
      (
        await db.admin.query(
          'SELECT deleted_at IS NOT NULL AS trashed FROM contact_interactions WHERE parent_id=$1',
          [contact],
        )
      ).rows,
    ).toEqual(Array.from({ length: family.placements.length }, () => ({ trashed: true })));
  } finally {
    await child.query('ROLLBACK');
    await updating;
    await parent.query('ROLLBACK');
    child.release();
    parent.release();
  }
});
