import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';

const family = buildFamily();
let db: TestDatabase;
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  await seedFamily(db.admin, family);
});
afterAll(async () => db?.drop());
it('ключи и журнал: только владелец, без контекста пусто; worker и owner не обходят RLS', async () => {
  const owner = family.person('anna');
  const client = await db.auth.query(
    "INSERT INTO chat_clients(name,redirects) VALUES ('Учебный','[\"https://client.example/callback\"]') RETURNING id",
  );
  const house = await db.admin.query("SELECT id FROM spaces WHERE kind='household' LIMIT 1");
  await db.auth.query(
    "INSERT INTO chat_grants(space_id,account_id,house_id,client_id,name,access_hash,refresh_hash,access_expires_at) VALUES ((SELECT id FROM spaces WHERE owner_account_id=$1),$1,$2,$3,'Учебный','access-hash','refresh-hash',now()+interval '1 hour')",
    [owner.id, house.rows[0].id, client.rows[0].id],
  );
  await db.admin.query(
    "INSERT INTO chat_events(space_id,account_id,action,kind) VALUES ((SELECT id FROM spaces WHERE owner_account_id=$1),$1,'create_drafts','note')",
    [owner.id],
  );
  for (const table of ['chat_grants', 'chat_events']) {
    expect((await db.app.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
    for (const person of ['anna', 'boris', 'vera'] as const) {
      const c = await db.app.connect();
      try {
        await c.query('BEGIN');
        await c.query("SELECT set_config('app.account_id',$1,true)", [family.person(person).id]);
        expect((await c.query(`SELECT * FROM ${table}`)).rowCount).toBe(person === 'anna' ? 1 : 0);
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
    }
    expect((await db.owner.query(`SELECT * FROM ${table}`)).rowCount).toBe(0);
    await expect(db.worker.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({
      code: '42501',
    });
  }
  for (const table of ['chat_clients', 'chat_codes'])
    await expect(db.app.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
});
