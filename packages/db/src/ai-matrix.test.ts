import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
afterAll(async () => {
  await db?.drop();
});
it('AI-3: матрица настройки дома; по умолчанию выключена, меняют только администраторы своего дома', async () => {
  for (const house of scene.family.houses)
    for (const person of scene.family.people) {
      const role = person.viewer.memberships.get(house.id);
      const visible = await scene.as(person.key, (tx) =>
        tx.execute<{ ai_enabled: boolean }>(
          sql`SELECT ai_enabled FROM spaces WHERE id=${house.id}`,
        ),
      );
      expect(visible.rows.length).toBe(role ? 1 : 0);
      const changed = await scene.as(person.key, async (tx) => {
        await tx.execute(sql`SAVEPOINT ai_probe`);
        try {
          return (await tx.execute(sql`UPDATE spaces SET ai_enabled=true WHERE id=${house.id}`))
            .rowCount;
        } finally {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT ai_probe`);
        }
      });
      expect(changed).toBe(role === 'admin' ? 1 : 0);
    }
});
it('AI-7: выключение, чужой дом и атомарный дневной предел', async () => {
  const house = scene.home('household').spaceId;
  const consume = (who: 'anna' | 'boris' | 'vera' | 'gleb') =>
    scene.as(
      who,
      async (tx) =>
        (
          await tx.execute<{ ok: boolean }>(
            sql`SELECT app.consume_ai_request(${house}::uuid,2) AS ok`,
          )
        ).rows[0]?.ok,
    );
  expect(await consume('boris')).toBe(false);
  await db.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [house]);
  expect(await consume('gleb')).toBe(false);
  const results = await Promise.all([consume('anna'), consume('boris'), consume('vera')]);
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(await consume('boris')).toBe(false);
});

it('AI-7: ни одна роль участника не сбрасывает счётчик; прямой INSERT только расходует', async () => {
  const house = scene.home('household').spaceId;
  await db.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [house]);
  for (const person of scene.family.people) {
    await expect(
      scene.as(person.key, (tx) =>
        tx.execute(sql`UPDATE ai_daily_usage SET requests=1 WHERE house_id=${house}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(
      scene.as(person.key, (tx) =>
        tx.execute(sql`DELETE FROM ai_daily_usage WHERE house_id=${house}`),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  }
  const before = (
    await db.admin.query('SELECT requests FROM ai_daily_usage WHERE house_id=$1', [house])
  ).rows[0].requests;
  await scene.as('vera', (tx) =>
    tx.execute(
      sql`INSERT INTO ai_daily_usage(house_id,usage_date,requests) SELECT ${house},(now() AT TIME ZONE coalesce(time_zone,'UTC'))::date,100 FROM spaces WHERE id=${house}`,
    ),
  );
  expect(
    (await db.admin.query('SELECT requests FROM ai_daily_usage WHERE house_id=$1', [house])).rows[0]
      .requests,
  ).toBe(before + 1);
  await expect(
    scene.as('gleb', (tx) =>
      tx.execute(sql`INSERT INTO ai_daily_usage VALUES(${house},current_date,100)`),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
  await expect(
    scene.as('vera', (tx) =>
      tx.execute(sql`INSERT INTO ai_daily_usage VALUES(${house},current_date-1,100)`),
    ),
  ).rejects.toMatchObject({ cause: { code: '42501' } });
  expect(
    (await db.admin.query('SELECT requests FROM ai_daily_usage WHERE house_id=$1', [house])).rows[0]
      .requests,
  ).toBe(before + 1);
});

it('AI-7: день расхода и остатка совпадает с поясом дома', async () => {
  const house = scene.home('household').spaceId;
  await db.admin.query('UPDATE spaces SET ai_enabled=true,time_zone=$2 WHERE id=$1', [
    house,
    'Pacific/Kiritimati',
  ]);
  await scene.as('vera', (tx) =>
    tx.execute(sql`SELECT app.consume_ai_request(${house}::uuid,100)`),
  );
  const rows = await db.admin.query(
    "SELECT usage_date=(now() AT TIME ZONE 'Pacific/Kiritimati')::date AS local FROM ai_daily_usage WHERE house_id=$1 ORDER BY usage_date DESC LIMIT 1",
    [house],
  );
  expect(rows.rows[0].local).toBe(true);
  const remaining = await scene.as('vera', (tx) =>
    tx.execute<{ n: number }>(sql`SELECT app.ai_remaining(${house}::uuid,100) AS n`),
  );
  expect(remaining.rows[0]?.n).toBeLessThan(100);
});
