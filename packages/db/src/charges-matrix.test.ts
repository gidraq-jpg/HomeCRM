import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';

let db: TestDatabase;
const family = buildFamily();
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(db.admin, family);
});
afterAll(async () => db?.drop());
it('OBJ-5: взрослый убирает чужой объект с начислениями разных авторов целиком', async () => {
  const object = family.records.find(
    (r) =>
      r.type === 'object' &&
      r.facts.placement.kind === 'household' &&
      r.facts.placement.spaceId === family.houses[0]?.id &&
      r.facts.placement.audience === 'adults' &&
      r.facts.authorId === family.person('anna').id &&
      !r.trashed,
  );
  expect(object).toBeDefined();
  await createAppDatabase(db.app).withAccount(family.person('boris').id, (tx) =>
    tx.execute(sql`UPDATE objects SET deleted_at=now() WHERE id=${object?.id}::uuid`),
  );
});
it('TPL-3: технические квитанции видит только автор; чужие вставка, правка и удаление запрещены', async () => {
  const author = family.person('boris').id;
  const key = randomUUID();
  const app = createAppDatabase(db.app);
  await app.withAccount(author, (tx) =>
    tx.execute(
      sql`INSERT INTO template_applications(account_id,key,request_hash) VALUES(${author}::uuid,${key}::uuid,'fictional-hash')`,
    ),
  );
  for (const person of family.people) {
    const rows = await app.withAccount(person.id, (tx) =>
      tx.execute(sql`SELECT key FROM template_applications`),
    );
    expect(rows.rows, person.name).toHaveLength(person.id === author ? 1 : 0);
    await expect(
      app.withAccount(person.id, (tx) =>
        tx.execute(sql`UPDATE template_applications SET request_hash='changed'`),
      ),
    ).rejects.toThrow();
    await expect(
      app.withAccount(person.id, (tx) => tx.execute(sql`DELETE FROM template_applications`)),
    ).rejects.toThrow();
    if (person.id !== author)
      await expect(
        app.withAccount(person.id, (tx) =>
          tx.execute(
            sql`INSERT INTO template_applications(account_id,key,request_hash) VALUES(${author}::uuid,${randomUUID()}::uuid,'forged')`,
          ),
        ),
      ).rejects.toThrow();
  }
});
