// Матрица правил входа (ADR-0005, ADR-0004, пункт 7): ответ базы на каждое сочетание участника,
// дома и действия совпадает с эталоном access.ts. Участники — вымышленная семья из family.ts
// и двое с «двойными» ролями из identity.ts.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import {
  buildIdentityWorld,
  IDENTITY_OPERATIONS,
  type IdentityWorld,
  runIdentityMatrix,
  seedIdentityRows,
} from './testing/identity.ts';

const family = buildFamily();
let database: TestDatabase;
let world: IdentityWorld;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  world = await buildIdentityWorld(database, family);
  await seedIdentityRows(database, world);
});

afterAll(async () => {
  await database?.drop();
});

describe('правила входа: база совпадает с эталоном access.ts', () => {
  it.each(IDENTITY_OPERATIONS)('%s', async (operation) => {
    const report = await runIdentityMatrix(database, world, operation);
    expect(report.mismatches).toEqual([]);
    // Матрица не вырождена: есть и разрешённые, и запрещённые попытки.
    expect(report.checks).toBeGreaterThan(0);
    expect(report.allowedByReference).toBeGreaterThan(0);
    expect(report.allowedByReference).toBeLessThan(report.checks);
  });

  it('участников семь, домов два: Мила — ребёнок в одном доме и взрослая в другом', () => {
    expect(world.people.map((person) => person.name)).toEqual([
      'Анна',
      'Борис',
      'Вера',
      'Глеб',
      'Дина',
      'Мила',
      'Ян',
    ]);
    const mila = world.people.find((person) => person.name === 'Мила');
    expect([...(mila?.viewer.memberships.values() ?? [])].sort()).toEqual(['adult', 'child']);
    expect(world.houses).toHaveLength(2);
  });
});
