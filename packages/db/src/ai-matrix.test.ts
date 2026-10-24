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
