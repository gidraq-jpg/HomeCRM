// Матрица доступа: ответы PostgreSQL (роль homecrm_app, политики RLS) совпадают с access.ts
// на каждом сочетании участник × место × вид записи × автор × ответственный × операция.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type AppDatabase, createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, type Family, seedFamily } from './testing/family.ts';
import { OPERATION_LABELS, OPERATIONS, runMatrix } from './testing/matrix.ts';

let database: TestDatabase;
let app: AppDatabase;
const family: Family = buildFamily();
let totalChecks = 0;

beforeAll(async () => {
  database = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(database.admin, family);
  app = createAppDatabase(database.app);
});

afterAll(async () => {
  await database?.drop();
  if (totalChecks > 0) console.info(`Матрица доступа: ${totalChecks} проверок`);
});

describe('матрица доступа: база отвечает так же, как access.ts', () => {
  for (const operation of OPERATIONS) {
    it(OPERATION_LABELS[operation], async () => {
      const report = await runMatrix(app, family, operation);
      totalChecks += report.checks;
      expect(report.mismatches).toEqual([]);
      // Матрица не вырождена: в каждой операции есть и разрешённые, и запрещённые попытки.
      // Удаление мимо корзины запрещено всем.
      if (operation === 'delete') {
        expect(report.allowedByReference).toBe(0);
      } else {
        expect(report.allowedByReference).toBeGreaterThan(0);
        expect(report.allowedByReference).toBeLessThan(report.checks);
      }
    });
  }
});
