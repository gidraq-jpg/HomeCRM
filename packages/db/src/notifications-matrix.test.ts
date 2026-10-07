import { randomUUID } from 'node:crypto';
import { canManageNotifications } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { createScene, type Scene } from './testing/helpers.ts';
import { isDenied } from './testing/matrix.ts';

let db: TestDatabase, scene: Scene;
const ids = new Map<string, string>();
beforeAll(async () => {
  db = await createTestDatabase(inject('pgAdminUrl'));
  scene = await createScene(db);
  for (const person of scene.family.people) {
    const session = randomUUID();
    ids.set(person.id, session);
    await db.admin.query(
      "INSERT INTO sessions(id,user_id,token,expires_at) VALUES($1::uuid,$2,$1::text,now()+interval '1 day')",
      [session, person.id],
    );
    await db.admin.query(
      "INSERT INTO push_subscriptions(account_id,session_id,endpoint,p256dh,auth,device_name) VALUES($1,$2::uuid,$2::text,'fictional','fictional','Телефон')",
      [person.id, session],
    );
    await db.admin.query('INSERT INTO notification_settings(account_id) VALUES($1)', [person.id]);
    await db.admin.query(
      "INSERT INTO push_attempts(account_id,device_id,result) VALUES($1,$2,'sent')",
      [person.id, session],
    );
  }
});
afterAll(async () => {
  await db?.drop();
});
it('матрица: все участники × владельцы × подписки/настройки/журнал; администратор не исключение', async () => {
  for (const viewer of scene.family.people)
    for (const owner of scene.family.people)
      for (const table of ['push_subscriptions', 'notification_settings', 'push_attempts']) {
        const expected = canManageNotifications(viewer.viewer, owner.id);
        const result = await createAppDatabase(db.app).withAccount(viewer.id, (tx) =>
          tx.execute(sql.raw(`SELECT * FROM ${table} WHERE account_id='${owner.id}'`)),
        );
        expect(result.rowCount === 1, `${viewer.key}/${owner.key}/${table}`).toBe(expected);
        if (table !== 'push_attempts') {
          const mutation =
            table === 'push_subscriptions' ? "device_name='Проверка'" : 'hide_text=false';
          const changed = await createAppDatabase(db.app).withAccount(viewer.id, (tx) =>
            tx.execute(sql.raw(`UPDATE ${table} SET ${mutation} WHERE account_id='${owner.id}'`)),
          );
          expect(changed.rowCount === 1, `update ${viewer.key}/${owner.key}/${table}`).toBe(
            expected,
          );
          let inserted = false;
          try {
            const statement =
              table === 'notification_settings'
                ? `INSERT INTO notification_settings(account_id) VALUES('${owner.id}') ON CONFLICT(account_id) DO UPDATE SET hide_text=true`
                : `INSERT INTO push_subscriptions(account_id,session_id,endpoint,p256dh,auth,device_name) VALUES('${owner.id}','${ids.get(owner.id)}','${ids.get(owner.id)}','fictional','fictional','Телефон') ON CONFLICT(session_id) DO UPDATE SET device_name='Телефон'`;
            inserted =
              (
                await createAppDatabase(db.app).withAccount(viewer.id, (tx) =>
                  tx.execute(sql.raw(statement)),
                )
              ).rowCount === 1;
          } catch (error) {
            if (!isDenied(error)) throw error;
          }
          expect(inserted, `insert ${viewer.key}/${owner.key}/${table}`).toBe(expected);
        }
      }
});
it('подписка привязана к собственнику сессии и приложение не пишет журнал/состояния доставки', async () => {
  const anna = scene.person('anna'),
    boris = scene.person('boris');
  await expect(
    scene.as('anna', (tx) =>
      tx.execute(
        sql`INSERT INTO push_subscriptions(account_id,session_id,endpoint,p256dh,auth,device_name) VALUES(${anna.id},${ids.get(boris.id)},'fake-foreign','x','x','x')`,
      ),
    ),
  ).rejects.toThrow();
  for (const statement of [
    'SELECT * FROM push_deliveries',
    "INSERT INTO push_attempts(account_id,device_id,result) VALUES('00000000-0000-4000-8000-000000000000','00000000-0000-4000-8000-000000000001','sent')",
  ])
    await expect(db.app.query(statement)).rejects.toMatchObject({ code: '42501' });
  for (const table of ['push_subscriptions', 'notification_settings', 'push_attempts'])
    expect((await db.owner.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
});
it('матрица удаления подписок: только своих; журнал старше 90 дней очищает worker', async () => {
  for (const viewer of scene.family.people)
    for (const owner of scene.family.people) {
      const client = await db.app.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.account_id',$1,true)", [viewer.id]);
        const result = await client.query('DELETE FROM push_subscriptions WHERE account_id=$1', [
          owner.id,
        ]);
        expect(result.rowCount === 1).toBe(canManageNotifications(viewer.viewer, owner.id));
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    }
  await db.admin.query(
    "INSERT INTO push_attempts(account_id,device_id,result,attempted_at) VALUES($1,$2,'sent',now()-interval '91 days')",
    [scene.person('anna').id, randomUUID()],
  );
  expect((await db.worker.query('DELETE FROM push_attempts')).rowCount).toBe(1);
  expect((await db.admin.query('SELECT id FROM push_attempts')).rows).toHaveLength(
    scene.family.people.length,
  );
});
