import { randomUUID } from 'node:crypto';
import {
  canView,
  canWrite,
  OrganizationData,
  PropertyData,
  UtilityAccountData,
} from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { contacts, eq, objects, sql, utilityAccounts } from './index.ts';
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
async function parent() {
  return scene.as('boris', async (tx) => {
    const [row] = await tx
      .insert(objects)
      .values({
        ...placementColumns(scene.home('adults')),
        authorId: scene.person('boris').id,
        title: 'Вымышленная квартира',
        objectType: 'property',
        typeData: PropertyData.parse({ address: 'Вымышленная улица, 12', areaHundredths: 5731 }),
      })
      .returning();
    if (!row) throw Error('Missing parent');
    return row;
  });
}
it('UTIL-1: поля типа закрыты матрицей доступа во всех местах, включая прямой SQL', async () => {
  let checks = 0;
  for (const place of scene.family.placements) {
    const authorId =
      place.kind === 'personal'
        ? place.ownerId
        : place.spaceId === scene.home('household').spaceId
          ? scene.person('boris').id
          : scene.person('dina').id;
    const seeded = await db.admin.query(
      `INSERT INTO objects(space_id,space_kind,audience,author_id,title,object_type,type_data) VALUES($1,$2,$3,$4,'Вымышленная недвижимость','property','{"areaHundredths":5731}') RETURNING id`,
      [place.spaceId, place.kind, place.kind === 'household' ? place.audience : null, authorId],
    );
    const id = seeded.rows[0].id;
    for (const person of scene.family.people) {
      const visible = await scene.as(person.key, (tx) =>
        tx.select().from(objects).where(eq(objects.id, id)),
      );
      expect(visible.length > 0).toBe(canView(person.viewer, place));
      checks++;
      if (visible[0]) expect(visible[0].typeData).toHaveProperty('areaHundredths');
      let wrote = false;
      try {
        wrote = await scene.as(
          person.key,
          async (tx) =>
            (
              await tx
                .update(objects)
                .set({ typeData: { areaHundredths: 5777 } })
                .where(eq(objects.id, id))
                .returning()
            ).length > 0,
        );
      } catch (error) {
        if (!hasCode(error, ['42501'])) throw error;
      }
      expect(wrote).toBe(canWrite(person.viewer, { type: 'object', placement: place, authorId }));
      checks++;
    }
  }
  expect(checks).toBe(120);
});
it('OBJ-5: перенос и отдельная корзина счетов; восстановление чужого ребёнка вместе с родителем', async () => {
  const row = await parent();
  const create = (who: 'anna' | 'boris') =>
    scene.as(who, async (tx) => {
      const [child] = await tx
        .insert(utilityAccounts)
        .values({
          ...placementColumns(scene.home('adults')),
          authorId: scene.person(who).id,
          title: 'Вымышленный счёт',
          parentId: row.id,
        })
        .returning();
      if (!child) throw Error('Missing child');
      return child;
    });
  const own = await create('boris');
  await scene.as('boris', (tx) =>
    tx
      .update(objects)
      .set(placementColumns(scene.personal('boris')))
      .where(eq(objects.id, row.id)),
  );
  expect(
    (await db.admin.query('SELECT space_id FROM utility_accounts WHERE id=$1', [own.id])).rows[0]
      .space_id,
  ).toBe(scene.person('boris').personalSpaceId);
  await scene.as('boris', (tx) =>
    tx
      .update(objects)
      .set(placementColumns(scene.home('adults')))
      .where(eq(objects.id, row.id)),
  );
  const foreign = await create('anna');
  await scene.as('boris', (tx) =>
    tx.update(utilityAccounts).set({ deletedAt: new Date() }).where(eq(utilityAccounts.id, own.id)),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: new Date() }).where(eq(objects.id, row.id)),
  );
  await scene.as('boris', (tx) =>
    tx.update(objects).set({ deletedAt: null }).where(eq(objects.id, row.id)),
  );
  const children = (
    await db.admin.query('SELECT id,deleted_at FROM utility_accounts WHERE parent_id=$1', [row.id])
  ).rows;
  expect(children.find((child) => child.id === own.id).deleted_at).not.toBeNull();
  expect(children.find((child) => child.id === foreign.id).deleted_at).toBeNull();
  await expect(
    scene.as('boris', (tx) =>
      tx
        .update(objects)
        .set(placementColumns(scene.personal('boris')))
        .where(eq(objects.id, row.id)),
    ),
  ).rejects.toSatisfy((error: unknown) => hasCode(error, ['42501']));
});
it('UTIL-2: поставщик требует видимую живую организацию; удаление обнуляет ссылку даже в корзине', async () => {
  const row = await parent();
  const result = await db.admin.query(
    `INSERT INTO contacts(space_id,space_kind,audience,author_id,title) VALUES($1,'household','household',$2,'Вымышленная УК') RETURNING id`,
    [scene.home('household').spaceId, scene.person('anna').id],
  );
  const supplierId = result.rows[0].id;
  const child = await scene.as('boris', async (tx) => {
    const [item] = await tx
      .insert(utilityAccounts)
      .values({
        ...placementColumns(scene.home('adults')),
        authorId: scene.person('boris').id,
        title: 'Счёт УК',
        parentId: row.id,
        supplierId,
      })
      .returning();
    if (!item) throw Error('Missing account');
    return item;
  });
  await expect(
    scene.as('boris', (tx) =>
      tx
        .update(utilityAccounts)
        .set({ supplierId: randomUUID() })
        .where(eq(utilityAccounts.id, child.id)),
    ),
  ).rejects.toSatisfy((error: unknown) => hasCode(error, ['42501']));
  await scene.as('boris', (tx) =>
    tx
      .update(utilityAccounts)
      .set({ deletedAt: new Date() })
      .where(eq(utilityAccounts.id, child.id)),
  );
  await db.admin.query('ALTER TABLE contacts DISABLE TRIGGER contacts_trash_time');
  await db.admin.query("UPDATE contacts SET deleted_at=now()-interval '31 days' WHERE id=$1", [
    supplierId,
  ]);
  await db.admin.query('ALTER TABLE contacts ENABLE TRIGGER contacts_trash_time');
  expect((await db.worker.query('DELETE FROM contacts WHERE id=$1', [supplierId])).rowCount).toBe(
    1,
  );
  const saved = (await db.admin.query('SELECT * FROM utility_accounts WHERE id=$1', [child.id]))
    .rows[0];
  expect(saved.supplier_id).toBeNull();
  expect(saved.deleted_at).not.toBeNull();
  expect(saved.title).toBe('Счёт УК');
});
it('UTIL-2: история фиксирует содержимое и смену поставщика без закрытого id', async () => {
  const row = await parent();
  const child = await scene.as('boris', async (tx) => {
    const [item] = await tx
      .insert(utilityAccounts)
      .values({
        ...placementColumns(scene.home('adults')),
        authorId: scene.person('boris').id,
        title: 'Счёт',
        parentId: row.id,
        data: UtilityAccountData.parse({ number: '123-456' }),
      })
      .returning();
    if (!item) throw Error('Missing account');
    return item;
  });
  const [supplier] = await scene.as('anna', (tx) =>
    tx
      .insert(contacts)
      .values({
        ...placementColumns(scene.home('household')),
        authorId: scene.person('anna').id,
        title: 'Поставщик',
        data: OrganizationData.parse({}),
      })
      .returning(),
  );
  if (!supplier) throw Error('Missing supplier');
  await scene.as('boris', (tx) =>
    tx
      .update(utilityAccounts)
      .set({ supplierId: supplier.id })
      .where(eq(utilityAccounts.id, child.id)),
  );
  const history = await scene.as('boris', (tx) =>
    tx.execute(
      sql`SELECT changes FROM utility_accounts_history WHERE record_id=${child.id}::uuid ORDER BY created_at`,
    ),
  );
  expect(JSON.stringify(history.rows)).toContain('supplier_changed');
  expect(JSON.stringify(history.rows)).not.toContain(supplier.id);
});
