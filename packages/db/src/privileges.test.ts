// Права ролей на таблицы и колонки сверяются с эталоном построчно (ADR-0004): лишнее право роняет тест,
// как и недостающее. Каждая из испорченных выдач ниже находится.
import { afterEach, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { grantDifferences } from './testing/privileges.ts';

let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.drop();
  database = undefined;
});

describe('права ролей', () => {
  it('выданы ровно те, что нужны: ни лишних, ни недостающих', async () => {
    database = await createTestDatabase(inject('pgAdminUrl'));
    expect(await grantDifferences(database.admin)).toEqual([]);
  });

  const MUTATIONS: Array<{ title: string; sql: string; expected: string }> = [
    {
      title: 'приложение меняет автора записи',
      sql: 'GRANT UPDATE (author_id) ON notes TO homecrm_app',
      expected: 'лишнее: homecrm_app notes UPDATE author_id',
    },
    {
      title: 'приложение может удалять мимо корзины',
      sql: 'GRANT DELETE ON tasks TO homecrm_app',
      expected: 'лишнее: homecrm_app tasks DELETE *',
    },
    {
      title: 'обработчик читает названия записей',
      sql: 'GRANT SELECT (title) ON notes TO homecrm_worker',
      expected: 'лишнее: homecrm_worker notes SELECT title',
    },
    {
      title: 'обработчик может писать историю изменений',
      sql: 'GRANT UPDATE ON notes_history TO homecrm_worker',
      expected: 'лишнее: homecrm_worker notes_history UPDATE changes',
    },
    {
      title: 'приложение читает пароли',
      sql: 'GRANT SELECT ON credentials TO homecrm_app',
      expected: 'лишнее: homecrm_app credentials SELECT password',
    },
    {
      title: 'служба входа меняет роль участника дома',
      sql: 'GRANT UPDATE (role) ON space_members TO homecrm_auth',
      expected: 'лишнее: homecrm_auth space_members UPDATE role',
    },
    {
      title: 'у обработчика отозвано право передавать записи ушедшего',
      sql: 'REVOKE UPDATE (assignee_id) ON tasks FROM homecrm_worker',
      expected: 'не хватает: homecrm_worker tasks UPDATE assignee_id',
    },
    {
      title: 'история не вставляется — право отозвано у приложения',
      sql: 'REVOKE INSERT ON shopping_items_history FROM homecrm_app',
      expected: 'не хватает: homecrm_app shopping_items_history INSERT record_id',
    },
  ];

  for (const mutation of MUTATIONS) {
    it(`тест находит: ${mutation.title}`, async () => {
      database = await createTestDatabase(inject('pgAdminUrl'));
      // Права выдаёт и отзывает владелец таблиц — так же, как сделала бы ошибочная миграция.
      await database.owner.query(mutation.sql);
      expect(await grantDifferences(database.admin)).toContain(mutation.expected);
    });
  }
});
