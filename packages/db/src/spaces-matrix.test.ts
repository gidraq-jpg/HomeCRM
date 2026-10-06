// Матрица пространств, участников и учётных записей (SPACE-1…4): ответ базы на запрос без фильтра
// в коде — для каждого участника, включая Милу (ребёнок в одном доме, взрослая в другом), Яна и
// только что ушедшего из дома — совпадает с эталоном access.ts. Записать в эти таблицы приложение не может.
import { canViewAccount, canViewMembership, canViewSpace, type Viewer } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type AppDatabase, createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import { buildIdentityWorld, type IdentityWorld } from './testing/identity.ts';
import { isDenied } from './testing/matrix.ts';

const family = buildFamily();
let database: TestDatabase;
let app: AppDatabase;
let world: IdentityWorld;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  world = await buildIdentityWorld(database, family);
  app = createAppDatabase(database.app);
});

afterAll(async () => {
  await database?.drop();
});

interface SpaceRow {
  id: string;
  kind: 'personal' | 'household';
  owner_account_id: string | null;
}

async function expectMatrix(viewers: readonly { name: string; id: string; viewer: Viewer }[]) {
  const all = {
    spaces: (await database.admin.query<SpaceRow>('SELECT id, kind, owner_account_id FROM spaces'))
      .rows,
    members: (
      await database.admin.query<{ space_id: string; account_id: string }>(
        'SELECT space_id, account_id FROM space_members',
      )
    ).rows,
    accounts: (await database.admin.query<{ id: string }>('SELECT id FROM accounts')).rows,
  };
  let checks = 0;
  const mismatches: string[] = [];
  for (const person of viewers) {
    const seen = await app.withAccount(person.id, async (tx) => ({
      spaces: new Set(
        (await tx.execute<{ id: string }>(sql`SELECT id FROM spaces`)).rows.map((r) => r.id),
      ),
      members: new Set(
        (
          await tx.execute<{ space_id: string; account_id: string }>(
            sql`SELECT space_id, account_id FROM space_members`,
          )
        ).rows.map((r) => `${r.space_id}/${r.account_id}`),
      ),
      accounts: new Set(
        (await tx.execute<{ id: string }>(sql`SELECT id FROM accounts`)).rows.map((r) => r.id),
      ),
    }));
    for (const space of all.spaces) {
      const expected = canViewSpace(
        person.viewer,
        space.kind === 'personal'
          ? { kind: 'personal', id: space.id, ownerId: space.owner_account_id ?? '' }
          : { kind: 'household', id: space.id },
      );
      checks++;
      if (seen.spaces.has(space.id) !== expected)
        mismatches.push(`${person.name} · пространство ${space.id}`);
    }
    for (const member of all.members) {
      checks++;
      if (
        seen.members.has(`${member.space_id}/${member.account_id}`) !==
        canViewMembership(person.viewer, member.account_id)
      ) {
        mismatches.push(`${person.name} · участник ${member.account_id}`);
      }
    }
    for (const account of all.accounts) {
      checks++;
      if (seen.accounts.has(account.id) !== canViewAccount(person.viewer, account.id)) {
        mismatches.push(`${person.name} · учётная запись ${account.id}`);
      }
    }
  }
  return { checks, mismatches };
}

describe('пространства, участники и учётные записи', () => {
  it('каждый видит ровно то, что говорит access.ts: своё личное, свои дома, свои строки', async () => {
    const report = await expectMatrix(world.people);
    expect(report.mismatches).toEqual([]);
    expect(report.checks).toBeGreaterThan(100);
  });

  it('после ухода из дома участник видит ровно то, что осталось: личное и другой дом', async () => {
    const [, neighbours] = world.houses;
    const mila = world.people.find((person) => person.name === 'Мила');
    if (neighbours === undefined || mila === undefined) throw new Error('No Mila or neighbours');
    await database.auth.query(
      `UPDATE space_members SET left_at = now(), left_by = account_id WHERE space_id = $1 AND account_id = $2`,
      [neighbours.id, mila.id],
    );
    const memberships = new Map(mila.viewer.memberships);
    memberships.delete(neighbours.id);
    const after = world.people.map((person) =>
      person === mila ? { ...person, viewer: { ...person.viewer, memberships } } : person,
    );
    const report = await expectMatrix(after);
    expect(report.mismatches).toEqual([]);
  });

  it('приложение не создаёт, не меняет и не удаляет учётные записи, пространства и участников', async () => {
    const anna = family.person('anna');
    for (const statement of [
      `INSERT INTO spaces (kind, name) VALUES ('household', 'Чужой дом')`,
      `INSERT INTO space_members (space_id, account_id, role) VALUES ('${family.houses[0]?.id}', '${anna.id}', 'admin')`,
      `UPDATE space_members SET role = 'admin'`,
      `UPDATE space_members SET left_at = now(), left_by = account_id`,
      `UPDATE spaces SET name = 'взлом'`,
      `UPDATE accounts SET display_name = 'взлом'`,
      `DELETE FROM space_members`,
      `DELETE FROM spaces`,
      `DELETE FROM accounts`,
    ]) {
      await expect(
        app.withAccount(anna.id, (tx) => tx.execute(sql.raw(statement))),
        statement,
      ).rejects.toSatisfy(isDenied);
    }
  });
});
