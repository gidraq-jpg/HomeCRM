// Матрица доступа: ответы PostgreSQL (роль homecrm_app, политики RLS) совпадают с access.ts
// на каждом сочетании участник × место × вид записи × автор × ответственный × операция.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { RECORD_TYPES } from './access-sql.ts';
import { type AppDatabase, createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, type Family, seedFamily, TYPE_LABELS } from './testing/family.ts';
import { FORBIDDEN_FOR_ALL, OPERATION_LABELS, OPERATIONS, runMatrix } from './testing/matrix.ts';

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
    // Изменение и перенос запускают каскады: делим по виду без сокращения матрицы.
    const groups =
      operation === 'edit'
        ? RECORD_TYPES.map((type) => [type])
        : operation === 'move'
          ? RECORD_TYPES.filter((type) =>
              family.records.some((row) => row.type === type && row.parentId === undefined),
            ).map((type) => [type])
          : [undefined];
    for (const types of groups) {
      const label = types?.[0]
        ? `${OPERATION_LABELS[operation]}: ${TYPE_LABELS[types[0]]}`
        : OPERATION_LABELS[operation];
      it(label, async () => {
        const report = await runMatrix(app, family, operation, types);
        totalChecks += report.checks;
        expect(report.mismatches).toEqual([]);
        if (operation === 'move' && types) {
          const roots = family.records.filter(
            (row) => types.includes(row.type) && row.parentId === undefined,
          );
          expect(report.checks).toBe(
            roots.length * family.people.length * (family.placements.length - 1),
          );
        }
        // Матрица не вырождена: в каждой операции есть и разрешённые, и запрещённые попытки.
        // Удаление мимо корзины и подмена автора, времени создания и id запрещены всем.
        if (FORBIDDEN_FOR_ALL.includes(operation)) {
          expect(report.allowedByReference).toBe(0);
        } else {
          expect(report.allowedByReference).toBeGreaterThan(0);
          expect(report.allowedByReference).toBeLessThan(report.checks);
        }
      });
    }
  }
});
