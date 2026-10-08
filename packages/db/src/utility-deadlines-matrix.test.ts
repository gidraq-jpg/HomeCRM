import { canView, DeadlineRule, type Placement } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';

let db: TestDatabase;
const family = buildFamily();
const examples: { objectId: string; place: Placement }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  const rule = DeadlineRule.parse({
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day: 20, endDay: 25 },
  });
  const payment = DeadlineRule.parse({
    kind: 'repeat',
    anchor: '2026-01-01',
    repeat: { unit: 'month', day: 25 },
  });
  for (const place of family.placements) {
    const author =
      place.kind === 'personal'
        ? family.people.find((p) => p.id === place.ownerId)
        : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin');
    if (!author || author.viewer.memberships.size === 0) continue;
    const cols = placementColumns(place);
    const obj = (
      await db.admin.query(
        `INSERT INTO objects(space_id,space_kind,audience,author_id,title) VALUES($1,$2,$3,$4,'Вымышленный источник коммуналки') RETURNING id`,
        [place.spaceId, place.kind, cols.audience, author.id],
      )
    ).rows[0];
    const acc = (
      await db.admin.query(
        `INSERT INTO utility_accounts(space_id,space_kind,audience,author_id,title,parent_id,data) VALUES($1,$2,$3,$4,'Вымышленный счёт',$5,$6) RETURNING id`,
        [
          place.spaceId,
          place.kind,
          cols.audience,
          author.id,
          obj.id,
          JSON.stringify({ readingRule: rule, paymentRule: payment }),
        ],
      )
    ).rows[0];
    await db.admin.query(
      `INSERT INTO meters(space_id,space_kind,audience,author_id,title,parent_id,utility_account_id,data) VALUES($1,$2,$3,$4,'Вымышленный прибор',$5,$6,'{"resource":"cold_water","status":"active","nextVerificationOn":"2026-12-01"}')`,
      [place.spaceId, place.kind, cols.audience, author.id, obj.id, acc.id],
    );
    examples.push({ objectId: obj.id, place });
  }
});
afterAll(async () => {
  await db?.drop();
});
it('матрица коммунальных сроков: все размещения и участники совпадают с canView, включая личное администратора и чужой дом', async () => {
  const app = createAppDatabase(db.app);
  for (const person of family.people) {
    const rows = await app.withAccount(person.id, (tx) =>
      tx.execute<{ object_id: string; source_kind: string }>(
        `SELECT object_id,source_kind FROM deadlines WHERE source_kind<>'record'`,
      ),
    );
    const actual = rows.rows.map((r) => `${r.object_id}:${r.source_kind}`).sort();
    const expected = examples
      .filter((e) => canView(person.viewer, e.place))
      .flatMap((e) => ['readings', 'payment', 'verification'].map((k) => `${e.objectId}:${k}`))
      .sort();
    expect(actual, person.name).toEqual(expected);
  }
});
it('прямой вызов служебного создателя сроков и подмена источника приложением запрещены', async () => {
  const person = family.person('boris');
  const app = createAppDatabase(db.app);
  await expect(
    app.withAccount(person.id, (tx) =>
      tx.execute(
        `SELECT app.put_utility_deadline('payment',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'{}'::jsonb,NULL)`,
      ),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
  expect(
    (await db.admin.query("SELECT policyname FROM pg_policies WHERE policyname='utility_seed'"))
      .rows,
  ).toEqual([]);
});
