import { canViewDocument, IDENTITY_DOCUMENT_TYPES, type Placement } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
const examples: { id: string; place: Placement; ownerIsChild: boolean; identity: boolean }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  // Моделируем старые общие удостоверения до смены роли владельца на ребёнка.
  await db.admin.query("UPDATE space_members SET role='adult' WHERE role='child'");
  for (const place of family.placements) {
    const author =
      place.kind === 'personal'
        ? place.ownerId
        : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin')?.id;
    if (!author) throw new Error('Missing fixture author');
    for (const owner of [family.person('vera'), family.person('mila'), family.person('boris')]) {
      for (const type of [...IDENTITY_DOCUMENT_TYPES, 'other']) {
        const cols = placementColumns(place);
        const result = await db.admin.query(
          `INSERT INTO documents(space_id,space_kind,audience,author_id,title,owner_account_id,data)
           VALUES($1,$2,$3,$4,'Вымышленная матрица удостоверений',$5,$6) RETURNING id`,
          [
            place.spaceId,
            place.kind,
            cols.audience,
            author,
            owner.id,
            JSON.stringify({ type, indefinite: true }),
          ],
        );
        examples.push({
          id: result.rows[0].id,
          place,
          identity: type !== 'other',
          ownerIsChild: [...owner.viewer.memberships.values()].includes('child'),
        });
      }
    }
  }
  for (const house of family.houses)
    for (const [key, role] of house.members)
      await db.admin.query('UPDATE space_members SET role=$1 WHERE space_id=$2 AND account_id=$3', [
        role,
        house.id,
        family.person(key).id,
      ]);
});
afterAll(async () => db?.drop());

it('DOC-2: удостоверение × владелец-ребёнок × зритель-ребёнок, все типы, места и несколько домов', async () => {
  const app = createAppDatabase(db.app);
  for (const viewer of family.people) {
    const rows = await app.withAccount(viewer.id, (tx) =>
      tx.execute<{ id: string }>(sql`SELECT id FROM documents`),
    );
    const visible = new Set(rows.rows.map((r) => r.id));
    const history = await app.withAccount(viewer.id, (tx) =>
      tx.execute<{ record_id: string }>(sql`SELECT DISTINCT record_id FROM documents_history`),
    );
    const visibleHistory = new Set(history.rows.map((r) => r.record_id));
    for (const row of examples) {
      const expected = canViewDocument(viewer.viewer, row.place, row.identity, row.ownerIsChild);
      expect(visible.has(row.id), `${viewer.key}: ${JSON.stringify(row)}`).toBe(expected);
      expect(visibleHistory.has(row.id), `history ${viewer.key}: ${row.id}`).toBe(expected);
    }
  }
  console.info(`Матрица удостоверений: ${examples.length * family.people.length * 2} проверок`);
});

it('DOC-2: детская роль в недоступном зрителю доме учитывается без раскрытия членств', async () => {
  const app = createAppDatabase(db.app);
  const dina = family.person('dina');
  const vera = family.person('vera');
  const result = await app.withAccount(dina.id, (tx) =>
    tx.execute<{ child: boolean; memberships: number }>(sql`
    SELECT app.document_owner_is_child(${vera.id}::uuid) AS child,
      (SELECT count(*)::int FROM space_members WHERE account_id=${vera.id}::uuid) AS memberships
  `),
  );
  expect(result.rows).toEqual([{ child: true, memberships: 0 }]);
  expect(
    (await db.worker.query('SELECT app.document_owner_is_child($1) AS child', [vera.id])).rows,
  ).toEqual([{ child: true }]);
  await expect(
    db.auth.query('SELECT app.document_owner_is_child($1)', [vera.id]),
  ).rejects.toMatchObject({ code: '42501' });
});
