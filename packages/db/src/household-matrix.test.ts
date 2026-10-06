import {
  canChangeRole,
  canExclude,
  canLeave,
  canViewMembership,
  canViewProfile,
  ROLES,
} from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { MEMBERS_SELECT_SQL, PROFILES_SELECT_SQL } from './access-sql.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { addNote, createScene, type Scene } from './testing/helpers.ts';
import { hasCode, isDenied } from './testing/matrix.ts';

let db: TestDatabase;
let scene: Scene;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
});
afterAll(async () => {
  await db?.drop();
});

async function matrix() {
  const { rows: membership } = await db.admin.query<{
    space_id: string;
    account_id: string;
    role: 'admin' | 'adult' | 'child';
    left_at: Date | null;
  }>('SELECT space_id, account_id, role, left_at FROM space_members');
  const mismatches: string[] = [];
  let checks = 0;
  const check = (label: string, actual: boolean, expected: boolean) => {
    checks++;
    if (actual !== expected) mismatches.push(label);
  };
  for (const person of scene.family.people) {
    const visible = await scene.as(person.key, async (tx) => ({
      members: (
        await tx.execute<{ space_id: string; account_id: string }>(
          sql`SELECT space_id, account_id FROM space_members`,
        )
      ).rows,
      profiles: (
        await tx.execute<{ account_id: string }>(sql`SELECT account_id FROM member_profiles`)
      ).rows,
      index: (
        await tx.execute<{ space_id: string; account_id: string }>(
          sql`SELECT space_id, account_id FROM household_access`,
        )
      ).rows,
      accounts: (await tx.execute<{ id: string }>(sql`SELECT id FROM accounts`)).rows,
    }));
    for (const row of membership)
      check(
        `${person.key}: member ${row.space_id}/${row.account_id}`,
        visible.members.some((m) => m.space_id === row.space_id && m.account_id === row.account_id),
        canViewMembership(person.viewer, row.account_id, row.space_id),
      );
    for (const owner of scene.family.people) {
      check(
        `${person.key}: profile ${owner.key}`,
        visible.profiles.some((p) => p.account_id === owner.id),
        canViewProfile(
          person.viewer,
          owner.id,
          membership
            .filter((m) => m.account_id === owner.id && m.left_at === null)
            .map((m) => m.space_id),
        ),
      );
      check(
        `${person.key}: private account ${owner.key}`,
        visible.accounts.some((a) => a.id === owner.id),
        person.id === owner.id,
      );
      const edited = await scene.as(person.key, async (tx) => {
        await tx.execute(sql`SAVEPOINT probe`);
        try {
          return (
            (
              await tx.execute(
                sql`UPDATE member_profiles SET phone = 'fictional' WHERE account_id = ${owner.id}`,
              )
            ).rowCount === 1
          );
        } finally {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
        }
      });
      check(`${person.key}: edit profile ${owner.key}`, edited, person.id === owner.id);
    }
    for (const house of scene.family.houses) {
      check(
        `${person.key}: index ${house.id}`,
        visible.index.some((i) => i.space_id === house.id && i.account_id === person.id),
        person.viewer.memberships.has(house.id),
      );
      check(
        `${person.key}: foreign index ${house.id}`,
        visible.index.some((i) => i.account_id !== person.id),
        false,
      );
      const adminIds = membership
        .filter((m) => m.space_id === house.id && m.role === 'admin' && m.left_at === null)
        .map((m) => m.account_id);
      for (const target of scene.family.people) {
        for (const role of ROLES) {
          let actual = false;
          await scene.as(person.key, async (tx) => {
            await tx.execute(sql`SAVEPOINT probe`);
            try {
              actual =
                (
                  await tx.execute(
                    sql`UPDATE space_members SET role = ${role} WHERE space_id = ${house.id} AND account_id = ${target.id}`,
                  )
                ).rowCount === 1;
            } catch (error) {
              if (!isDenied(error) && !hasCode(error, ['23514'])) throw error;
            } finally {
              await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
            }
          });
          check(
            `${person.key}: role ${house.id}/${target.key}/${role}`,
            actual,
            canChangeRole(person.viewer, house.id, target.viewer, role, adminIds),
          );
        }
        let actual = false;
        await scene.as(person.key, async (tx) => {
          await tx.execute(sql`SAVEPOINT probe`);
          try {
            actual =
              (
                await tx.execute(
                  sql`UPDATE space_members SET left_at = now(), left_by = ${person.id} WHERE space_id = ${house.id} AND account_id = ${target.id}`,
                )
              ).rowCount === 1;
          } catch (error) {
            if (!isDenied(error) && !hasCode(error, ['23514'])) throw error;
          } finally {
            await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
          }
        });
        check(
          `${person.key}: departure ${house.id}/${target.key}`,
          actual,
          (person.id === target.id || canExclude(person.viewer, house.id, target.viewer)) &&
            canLeave(target.viewer, house.id, adminIds),
        );
      }
    }
  }
  return { checks, mismatches };
}

it('состав, профиль, роли и уход: SQL без фильтров совпадает с эталоном', async () => {
  const report = await matrix();
  expect(report.mismatches).toEqual([]);
  expect(report.checks).toBeGreaterThan(400);
  console.info(`Household matrix: ${report.checks} checks, ${report.mismatches.length} mismatches`);
});

it.each([
  ['space_members', 'space_members_select', MEMBERS_SELECT_SQL],
  ['member_profiles', 'member_profiles_select', PROFILES_SELECT_SQL],
  ['household_access', 'household_access_select', 'account_id = app.current_account_id()'],
] as const)('ослабление чтения %s выявляется матрицей', async (table, policy, original) => {
  try {
    await db.admin.query(`ALTER POLICY ${policy} ON ${table} USING (true)`);
    expect((await matrix()).mismatches.length).toBeGreaterThan(0);
  } finally {
    await db.admin.query(`ALTER POLICY ${policy} ON ${table} USING (${original})`);
  }
});

it('производные строки и закрытые функции нельзя изменить или вызвать напрямую', async () => {
  for (const pool of [db.app, db.auth, db.worker]) {
    for (const statement of [
      'DELETE FROM household_access',
      "UPDATE household_access SET role = 'admin'",
      'SELECT app.sync_household_access()',
      'SELECT app.initialize_member_profile()',
    ])
      await expect(pool.query(statement)).rejects.toMatchObject({ code: '42501' });
  }
  expect((await db.owner.query('SELECT * FROM household_access')).rows).toEqual([]);
  expect((await db.owner.query('SELECT * FROM member_profiles')).rows).toEqual([]);
  await expect(
    scene.as('anna', (tx) =>
      tx.execute(
        sql`UPDATE space_members SET display_name = 'подмена' WHERE account_id = ${scene.person('boris').id}`,
      ),
    ),
  ).rejects.toSatisfy(isDenied);
});

it('два администратора не могут одновременно уйти: личное сохраняется, общая ответственность передаётся', async () => {
  const houseId = scene.family.houses[0]?.id;
  if (!houseId) throw new Error('No house');
  const boris = scene.person('boris');
  const shared = await addNote(db.admin, { author: boris, placement: scene.home('household') });
  const personal = await addNote(db.admin, { author: boris, placement: scene.personal('boris') });
  await scene.as('anna', (tx) =>
    tx.execute(
      sql`UPDATE space_members SET role = 'admin' WHERE space_id = ${houseId} AND account_id = ${boris.id}`,
    ),
  );
  const result = await Promise.allSettled(
    ['anna', 'boris'].map((key) => {
      const who = key as 'anna' | 'boris';
      return scene.as(who, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${houseId}::text, 0))`);
        return tx.execute(
          sql`UPDATE space_members SET left_at = now(), left_by = ${scene.person(who).id} WHERE space_id = ${houseId} AND account_id = ${scene.person(who).id}`,
        );
      });
    }),
  );
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const admins = (
    await db.admin.query(
      'SELECT account_id FROM space_members WHERE space_id = $1 AND role = $2 AND left_at IS NULL',
      [houseId, 'admin'],
    )
  ).rows;
  expect(admins).toHaveLength(1);
  await db.worker.query('SELECT app.reassign_responsibility()');
  const rows = (
    await db.admin.query(
      'SELECT id, author_id, assignee_id, space_kind FROM notes WHERE id = ANY($1)',
      [[shared, personal]],
    )
  ).rows;
  expect(rows.find((r) => r.id === personal)).toMatchObject({
    author_id: boris.id,
    assignee_id: boris.id,
    space_kind: 'personal',
  });
  expect(rows.find((r) => r.id === shared)?.author_id).toBe(boris.id);
  expect(rows.find((r) => r.id === shared)?.assignee_id).toBe(admins[0]?.account_id);
});

it('бывший участник сохраняет своё личное; семейные поля его профиля закрываются от бывшей семьи', async () => {
  const houseId = scene.family.houses[0]?.id;
  if (!houseId) throw new Error('No house');
  const former = (
    await db.admin.query(
      'SELECT account_id FROM space_members WHERE space_id = $1 AND left_at IS NOT NULL',
      [houseId],
    )
  ).rows[0]?.account_id;
  const current = (
    await db.admin.query(
      "SELECT account_id FROM space_members WHERE space_id = $1 AND role = 'admin' AND left_at IS NULL",
      [houseId],
    )
  ).rows[0]?.account_id;
  const currentPerson = scene.family.people.find((p) => p.id === current);
  const formerPerson = scene.family.people.find((p) => p.id === former);
  if (!currentPerson || !formerPerson) throw new Error('No participants');
  expect(
    await scene.as(currentPerson.key, (tx) =>
      tx.execute(sql`SELECT * FROM member_profiles WHERE account_id = ${former}`),
    ),
  ).toMatchObject({ rowCount: 0 });
  const named = await scene.as(formerPerson.key, (tx) =>
    tx.execute(
      sql`UPDATE member_profiles SET display_name = 'Новое семейное имя', phone = 'private-after-leaving' WHERE account_id = ${former}`,
    ),
  );
  expect(named.rowCount).toBe(1);
  const roster = await scene.as(currentPerson.key, (tx) =>
    tx.execute(
      sql`SELECT display_name FROM space_members WHERE account_id = ${former} AND space_id = ${houseId}`,
    ),
  );
  expect(roster.rows[0]).toMatchObject({ display_name: 'Новое семейное имя' });
  expect(
    await scene.as(formerPerson.key, (tx) =>
      tx.execute(sql`SELECT * FROM member_profiles WHERE account_id = ${former}`),
    ),
  ).toMatchObject({ rowCount: 1 });
});
