import { MeterData } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { eq, meterReadings, meters, objects } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { placementColumns } from './testing/family.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { hasCode } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
afterAll(async () => {
  await db?.drop();
});
async function tree() {
  return scene.as('boris', async (tx) => {
    const [o] = await tx
      .insert(objects)
      .values({
        ...placementColumns(scene.personal('boris')),
        authorId: scene.person('boris').id,
        title: 'Вымышленный объект',
      })
      .returning();
    if (!o) throw Error('Missing object');
    const [m] = await tx
      .insert(meters)
      .values({
        ...placementColumns(scene.personal('boris')),
        authorId: scene.person('boris').id,
        title: 'Вымышленный счётчик',
        parentId: o.id,
        data: MeterData.parse({ resource: 'cold_water', integerDigits: 12, fractionDigits: 6 }),
      })
      .returning();
    if (!m) throw Error('Missing meter');
    const [r] = await tx
      .insert(meterReadings)
      .values({
        ...placementColumns(scene.personal('boris')),
        authorId: scene.person('boris').id,
        title: 'Показание',
        parentId: m.id,
        occurredOn: '2026-10-01',
        values: ['999999999999.123456'],
      })
      .returning();
    if (!r) throw Error('Missing reading');
    return { o, m, r };
  });
}
it('перенос объекта переносит оба уровня дерева; отдельная корзина и каскадное восстановление', async () => {
  const { o, m, r } = await tree();
  await scene.as('boris', (tx) =>
    tx
      .update(objects)
      .set(placementColumns(scene.home('adults')))
      .where(eq(objects.id, o.id)),
  );
  const [reading] = await scene.as('boris', (tx) =>
    tx.select().from(meterReadings).where(eq(meterReadings.id, r.id)),
  );
  expect(reading?.spaceId).toBe(scene.home('adults').spaceId);
  expect(reading?.audience).toBe('adults');
  expect(reading?.values).toEqual(['999999999999.123456']);
  expect(
    await scene.as('vera', (tx) =>
      tx.select().from(meterReadings).where(eq(meterReadings.id, r.id)),
    ),
  ).toEqual([]);
  await scene.as('boris', (tx) =>
    tx.update(meterReadings).set({ deletedAt: new Date() }).where(eq(meterReadings.id, r.id)),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, o.id)),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: null }).where(eq(objects.id, o.id)),
  );
  expect(
    (await scene.as('boris', (tx) => tx.select().from(meters).where(eq(meters.id, m.id))))[0]
      ?.deletedAt,
  ).toBeNull();
  expect(
    (
      await scene.as('boris', (tx) =>
        tx.select().from(meterReadings).where(eq(meterReadings.id, r.id)),
      )
    )[0]?.deletedAt,
  ).not.toBeNull();
});
it('составные FK и запрет смены родителя закрывают перенос показания отдельно от счётчика', async () => {
  const a = await tree();
  const b = await tree();
  await expect(
    scene.as('boris', (tx) =>
      tx.update(meterReadings).set({ parentId: b.m.id }).where(eq(meterReadings.id, a.r.id)),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['42501']));
  await expect(
    scene.as('boris', (tx) =>
      tx
        .update(meterReadings)
        .set(placementColumns(scene.home('household')))
        .where(eq(meterReadings.id, a.r.id)),
    ),
  ).rejects.toSatisfy((e: unknown) => hasCode(e, ['23503', '42501']));
});
it('очистка старого счётчика обнуляет ссылку замены без изменения нового и его истории', async () => {
  const { o, m } = await tree();
  await scene.as('boris', (tx) =>
    tx
      .update(meters)
      .set({ data: { ...m.data, status: 'replaced' } })
      .where(eq(meters.id, m.id)),
  );
  const [next] = await scene.as('boris', (tx) =>
    tx
      .insert(meters)
      .values({
        ...placementColumns(scene.personal('boris')),
        authorId: scene.person('boris').id,
        parentId: o.id,
        title: 'Новый вымышленный счётчик',
        previousMeterId: m.id,
        data: MeterData.parse({ resource: 'cold_water' }),
      })
      .returning(),
  );
  if (!next) throw Error('Missing replacement');
  await db.admin.query('ALTER TABLE meters DISABLE TRIGGER meters_trash_time');
  await db.admin.query(`UPDATE meters SET deleted_at=now()-interval '31 days' WHERE id=$1`, [m.id]);
  await db.admin.query('ALTER TABLE meters ENABLE TRIGGER meters_trash_time');
  expect((await db.worker.query('DELETE FROM meters WHERE id=$1', [m.id])).rowCount).toBe(1);
  const [after] = await scene.as('boris', (tx) =>
    tx.select().from(meters).where(eq(meters.id, next.id)),
  );
  expect(after).toEqual({ ...next, previousMeterId: null });
});
