// Матрица правил входа замечает поломку: на отдельной базе одна политика удалена или ослаблена,
// и матрица обязана найти расхождение с access.ts (как policy-mutations.test.ts для записей).
import { afterEach, describe, expect, inject, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import {
  buildIdentityWorld,
  type IdentityOperation,
  runIdentityMatrix,
  seedIdentityRows,
} from './testing/identity.ts';

interface Mutation {
  title: string;
  sql: string;
  operation: IdentityOperation;
  /** Пример расхождения, которое матрица должна показать. */
  expected: RegExp;
}

const MUTATIONS: Mutation[] = [
  {
    title: 'нет политики создания приглашений — администратор не может пригласить',
    sql: 'DROP POLICY invitations_insert ON invitations',
    operation: 'invite-create',
    expected: /^создать приглашение · Анна → Дом, роль adult: эталон — да, база — нет$/,
  },
  {
    title: 'приглашения читает любой — взрослый видит чужие ссылки',
    sql: 'ALTER POLICY invitations_select ON invitations USING (true)',
    operation: 'invite-view',
    expected: /^увидеть приглашения дома · Борис · приглашения Дом: эталон — нет, база — да$/,
  },
  {
    title: 'приглашение создаёт любой участник дома — ребёнок зовёт кого хочет',
    sql: `ALTER POLICY invitations_insert ON invitations WITH CHECK (
      household_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = app.current_account_id())
      AND created_by = app.current_account_id() AND accepted_at IS NULL AND revoked_at IS NULL)`,
    operation: 'invite-create',
    expected: /^создать приглашение · Вера → Дом, роль admin: эталон — нет, база — да$/,
  },
  {
    title: 'сброс пароля записывается без проверки «только ребёнку» — взрослому тоже',
    sql: 'ALTER POLICY password_resets_auth_insert ON password_resets WITH CHECK (true)',
    operation: 'reset-record',
    expected: /^записать сброс пароля · Анна → пароль Борис: эталон — нет, база — да$/,
  },
  {
    title:
      'правило «только ребёнку» забыло про двойные роли — Милу, взрослую в другом доме, сбросить можно',
    sql: `ALTER POLICY password_resets_auth_insert ON password_resets WITH CHECK (
      password_resets.requested_by <> password_resets.account_id
      AND EXISTS (
        SELECT 1 FROM space_members admin_m
        JOIN space_members child_m ON child_m.space_id = admin_m.space_id
        WHERE admin_m.account_id = password_resets.requested_by AND admin_m.role = 'admin'
          AND child_m.account_id = password_resets.account_id AND child_m.role = 'child'))`,
    operation: 'reset-record',
    expected: /^записать сброс пароля · Анна → пароль Мила: эталон — нет, база — да$/,
  },
  {
    title: 'журнал входов читает любой — администратор видит чужие входы',
    sql: 'ALTER POLICY login_events_select ON login_events USING (true)',
    operation: 'journal-view',
    expected: /^прочитать журнал входов · Анна · Вера: эталон — нет, база — да$/,
  },
  {
    title: 'RLS на отметках о сбросе выключена — посторонний читает всё',
    sql: 'ALTER TABLE password_resets DISABLE ROW LEVEL SECURITY',
    operation: 'notice-view',
    expected: /^прочитать отметку о сбросе · Глеб · Вера: эталон — нет, база — да$/,
  },
];

const family = buildFamily();
let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.drop();
  database = undefined;
});

describe('матрица правил входа находит испорченную политику', () => {
  for (const mutation of MUTATIONS) {
    it(mutation.title, async () => {
      database = await createTestDatabase(inject('pgAdminUrl'));
      await seedFamily(database.admin, family);
      const world = await buildIdentityWorld(database, family);
      await seedIdentityRows(database, world);
      // Политики меняет их владелец — так же, как это сделала бы ошибочная миграция.
      await database.owner.query(mutation.sql);

      const report = await runIdentityMatrix(database, world, mutation.operation);
      expect(report.mismatches.length).toBeGreaterThan(0);
      expect(
        report.mismatches.some((line) => mutation.expected.test(line)),
        report.mismatches.join('\n'),
      ).toBe(true);
    });
  }
});
