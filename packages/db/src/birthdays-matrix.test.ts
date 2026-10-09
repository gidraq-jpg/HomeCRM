import { randomUUID } from 'node:crypto';
import { canViewApiOperation, canViewBirthday, type RecordFacts } from '@homecrm/shared';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { sql } from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, placementColumns, seedPeople } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
const examples: { id: string; facts: RecordFacts; sourceId: string }[] = [];
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedPeople(db.admin, family);
  await db.admin.query("UPDATE spaces SET time_zone='Asia/Yekaterinburg' WHERE kind='household'");
  const app = createAppDatabase(db.app);
  for (const place of family.placements) {
    const author =
      place.kind === 'personal'
        ? family.people.find((p) => p.id === place.ownerId)
        : family.people.find((p) => p.viewer.memberships.get(place.spaceId) === 'admin');
    if (!author?.viewer.memberships.size) continue;
    const columns = placementColumns(place);
    const sourceId = (
      await app.withAccount(author.id, (tx) =>
        tx.execute<{
          id: string;
        }>(sql`INSERT INTO contacts(space_id,space_kind,audience,author_id,title,kind,data)
      VALUES(${columns.spaceId},${place.kind},${columns.audience},${author.id},'Вымышленный день рождения матрицы','person','{"birthday":"--10-10","birthdayEnabled":true}') RETURNING id`),
      )
    ).rows[0]?.id;
    if (!sourceId) throw new Error('Missing birthday fixture');
    const id = (await db.admin.query('SELECT id FROM deadlines WHERE contact_id=$1', [sourceId]))
      .rows[0]?.id;
    examples.push({
      id,
      sourceId,
      facts: { placement: place, type: 'contact', authorId: author.id },
    });
  }
});
afterAll(async () => db?.drop());
it('CONT-7: чтение по id и список совпадают с access.ts во всех местах, ролях и двух семьях; прямые изменения запрещены', async () => {
  const app = createAppDatabase(db.app);
  for (const person of family.people)
    for (const example of examples) {
      const expected = canViewBirthday(person.viewer, { contact: example.facts });
      const byId = await app.withAccount(person.id, (tx) =>
        tx.execute(sql`SELECT id FROM deadlines WHERE id=${example.id}::uuid`),
      );
      const list = await app.withAccount(person.id, (tx) =>
        tx.execute(sql`SELECT id FROM deadlines WHERE source_kind='birthday'`),
      );
      expect(byId.rowCount, `${person.key}/${example.id}`).toBe(expected ? 1 : 0);
      expect(list.rows.some((r) => r.id === example.id)).toBe(expected);
      expect(
        (
          await app.withAccount(person.id, (tx) =>
            tx.execute(sql`UPDATE deadlines SET rule='{}' WHERE id=${example.id}::uuid`),
          )
        ).rowCount,
      ).toBe(0);
    }
});
it('CONT-7: личный профиль виден себе и действующей семье, не соседям; выключение и корзина контакта скрывают производные даты', async () => {
  const app = createAppDatabase(db.app),
    owner = family.person('boris'),
    houses = [...owner.viewer.memberships.keys()];
  await app.withAccount(owner.id, (tx) =>
    tx.execute(
      sql`UPDATE member_profiles SET birth_date='1990-10-10',birthday_enabled=true WHERE account_id=${owner.id}::uuid`,
    ),
  );
  for (const person of family.people) {
    const rows = await app.withAccount(person.id, (tx) =>
      tx.execute(sql`SELECT id FROM deadlines WHERE profile_account_id=${owner.id}::uuid`),
    );
    expect(rows.rowCount).toBe(
      canViewBirthday(person.viewer, { accountId: owner.id, houseIds: houses }) ? 1 : 0,
    );
  }
  await app.withAccount(owner.id, (tx) =>
    tx.execute(
      sql`UPDATE member_profiles SET birthday_enabled=false WHERE account_id=${owner.id}::uuid`,
    ),
  );
  expect(
    (
      await app.withAccount(owner.id, (tx) =>
        tx.execute(sql`SELECT id FROM deadlines WHERE profile_account_id=${owner.id}::uuid`),
      )
    ).rowCount,
  ).toBe(0);
  const example = examples.find((e) => e.facts.placement.kind === 'household');
  if (!example) throw new Error('Missing household birthday');
  await db.admin.query('UPDATE contacts SET deleted_at=now() WHERE id=$1', [example.sourceId]);
  for (const person of family.people)
    expect(
      (
        await app.withAccount(person.id, (tx) =>
          tx.execute(sql`SELECT id FROM deadlines WHERE id=${example.id}::uuid`),
        )
      ).rowCount,
    ).toBe(0);
});
it('API: ключи идемпотентности — только собственные, без изменения и очистки runtime-ролями', async () => {
  const app = createAppDatabase(db.app),
    owner = family.person('boris'),
    key = randomUUID();
  await app.withAccount(owner.id, (tx) =>
    tx.execute(
      sql`INSERT INTO api_operations(account_id,key,operation,fingerprint,result_ids) VALUES(${owner.id},${key},'contact_import',${'a'.repeat(64)},'[]')`,
    ),
  );
  for (const person of family.people) {
    expect(
      (
        await app.withAccount(person.id, (tx) =>
          tx.execute(sql`SELECT * FROM api_operations WHERE key=${key}::uuid`),
        )
      ).rowCount,
    ).toBe(canViewApiOperation(person.viewer, owner.id) ? 1 : 0);
    await expect(
      app.withAccount(person.id, (tx) =>
        tx.execute(sql`UPDATE api_operations SET fingerprint=${'b'.repeat(64)}`),
      ),
    ).rejects.toThrow();
    if (person.id !== owner.id)
      await expect(
        app.withAccount(person.id, (tx) =>
          tx.execute(
            sql`INSERT INTO api_operations(account_id,key,operation,fingerprint,result_ids) VALUES(${owner.id},${randomUUID()},'charge',${'a'.repeat(64)},'[]')`,
          ),
        ),
      ).rejects.toThrow();
  }
  await expect(db.worker.query('SELECT * FROM api_operations')).rejects.toThrow();
  await expect(db.owner.query('SELECT * FROM contacts')).resolves.toMatchObject({ rowCount: 0 });
});
