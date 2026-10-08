import { randomUUID } from 'node:crypto';
import { canExportHouse, canExportPersonal, canViewExportEvent } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { canExportHouseSql, canExportPersonalSql } from './access-sql.ts';
import { sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { isDenied } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});

it('DATA-2: журнал — RLS чтения/вставки, запрет подмены автора, времени и удаления', async () => {
  const scopes = [null, ...scene.family.houses.map(({ id }) => id)];
  for (const actor of scene.family.people)
    for (const householdId of scopes)
      await db.admin.query(
        'INSERT INTO export_events(account_id,kind,household_id,counts,size_bytes) VALUES($1,$2,$3,$4,1)',
        [actor.id, householdId ? 'household' : 'personal', householdId, {}],
      );
  let checks = 0;
  for (const person of scene.family.people) {
    const events = await scene.as(
      person.key,
      async (tx) =>
        (
          await tx.execute<{ account_id: string; household_id: string | null }>(
            sql`SELECT account_id,household_id FROM export_events`,
          )
        ).rows,
    );
    for (const actor of scene.family.people)
      for (const householdId of scopes) {
        expect(
          events.some(
            (event) => event.account_id === actor.id && event.household_id === householdId,
          ),
        ).toBe(canViewExportEvent(person.viewer, actor.id, householdId));
        checks++;
        await scene.as(person.key, async (tx) => {
          await tx.execute(sql`SAVEPOINT probe`);
          let allowed = false;
          try {
            await tx.execute(
              sql`INSERT INTO export_events(account_id,kind,household_id,counts,size_bytes) VALUES(${actor.id}::uuid,${householdId ? 'household' : 'personal'},${householdId}::uuid,'{}',1)`,
            );
            allowed = true;
          } catch (error) {
            if (!isDenied(error)) throw error;
          } finally {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
          }
          expect(allowed).toBe(
            actor.id === person.id &&
              (householdId === null || canExportHouse(person.viewer, householdId)),
          );
          checks++;
        });
      }
  }
  expect(checks).toBe(216);
  await expect(
    scene.as('anna', (tx) => tx.execute(sql`DELETE FROM export_events`)),
  ).rejects.toSatisfy(isDenied);
  await expect(
    scene.as('anna', (tx) => tx.execute(sql`UPDATE export_events SET created_at=now()`)),
  ).rejects.toSatisfy(isDenied);
  await expect(
    scene.as('anna', (tx) =>
      tx.execute(
        sql`INSERT INTO export_events(account_id,kind,counts,size_bytes,created_at) VALUES(${scene.person('anna').id}::uuid,'personal','{}',1,'2000-01-01')`,
      ),
    ),
  ).rejects.toSatisfy(isDenied);
  const flags = await db.admin.query(
    'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
    ['export_events'],
  );
  expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
});
afterAll(async () => {
  await db?.drop();
});

it('DATA-2: запуск экспорта — матрица людей × домов и владельцев, включая выход', async () => {
  let checks = 0;
  let allowed = 0;
  async function matrix() {
    for (const person of scene.family.people) {
      for (const houseId of [...scene.family.houses.map(({ id }) => id), randomUUID()]) {
        const actual = await scene.as(
          person.key,
          async (tx) =>
            (
              await tx.execute<{ allowed: boolean }>(
                sql`SELECT ${sql.raw(canExportHouseSql())} AS allowed FROM (SELECT ${houseId}::uuid AS space_id) candidate`,
              )
            ).rows[0]?.allowed,
        );
        expect(actual).toBe(canExportHouse(person.viewer, houseId));
        checks++;
        if (actual) allowed++;
      }
      for (const owner of scene.family.people) {
        const actual = await scene.as(
          person.key,
          async (tx) =>
            (
              await tx.execute<{ allowed: boolean }>(
                sql`SELECT ${sql.raw(canExportPersonalSql())} AS allowed FROM (SELECT ${owner.id}::uuid AS owner_account_id) candidate`,
              )
            ).rows[0]?.allowed,
        );
        expect(actual).toBe(canExportPersonal(person.viewer, owner.id));
        checks++;
        if (actual) allowed++;
      }
    }
  }
  await matrix();
  const anna = scene.person('anna');
  const house = scene.family.houses[0];
  if (!house) throw new Error('Missing fictional house');
  await db.admin.query('UPDATE space_members SET role=$1 WHERE space_id=$2 AND account_id=$3', [
    'admin',
    house.id,
    scene.person('boris').id,
  ]);
  await db.admin.query(
    'UPDATE space_members SET left_at=now(),left_by=account_id WHERE space_id=$1 AND account_id=$2',
    [house.id, anna.id],
  );
  const memberships = new Map(anna.viewer.memberships);
  memberships.delete(house.id);
  anna.viewer = { ...anna.viewer, memberships };
  scene.person('boris').viewer = {
    ...scene.person('boris').viewer,
    memberships: new Map([[house.id, 'admin']]),
  };
  await matrix();
  expect(checks).toBe(108);
  expect(allowed).toBeGreaterThan(0);
  expect(allowed).toBeLessThan(checks);
});
