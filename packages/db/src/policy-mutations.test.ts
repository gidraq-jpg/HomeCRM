// Матрица замечает поломку: на отдельной базе одна политика удалена или ослаблена,
// и матрица обязана найти расхождение с access.ts. Так проверено, что она не проходит вхолостую.
import { afterEach, describe, expect, inject, it } from 'vitest';
import { CURRENT_ACCOUNT_SQL, canTrashSql, canWriteSql, type RecordType } from './access-sql.ts';
import { createAppDatabase } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing/database.ts';
import { buildFamily, seedFamily } from './testing/family.ts';
import { type Operation, runMatrix } from './testing/matrix.ts';

const ME = CURRENT_ACCOUNT_SQL;

interface Mutation {
  title: string;
  sql: string;
  operation: Operation;
  types: RecordType[];
  /** Пример расхождения, которое матрица должна показать. */
  expected: RegExp;
  /** Испортить до записи семьи: так, чтобы испорченный триггер не написал того, что обязан. */
  beforeSeed?: boolean;
}

const MUTATIONS: Mutation[] = [
  {
    title: 'чтение без RLS позволяет скопировать чужое личное — матрица замечает утечку',
    sql: 'ALTER POLICY notes_select ON notes USING (true)',
    operation: 'copy',
    types: ['note'],
    expected: /^Анна · копирование в личное · заметка · личное \(Борис\).*эталон — нет, база — да$/,
  },
  {
    title: 'нет политики чтения заметок — свои записи пропадают',
    sql: 'DROP POLICY notes_select ON notes',
    operation: 'view',
    types: ['note'],
    expected: /^Анна · чтение записи по id · заметка · личное \(Анна\).*эталон — да, база — нет$/,
  },
  {
    title: 'чтение заметок без проверки аудитории — ребёнок видит «Взрослые»',
    sql: `ALTER POLICY notes_select ON notes USING (
      (space_kind = 'personal' AND space_id IN (SELECT s.id FROM spaces s WHERE s.owner_account_id = ${ME}))
      OR (space_kind = 'household' AND space_id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = ${ME})))`,
    operation: 'view',
    types: ['note'],
    expected: /^Вера · чтение записи по id · заметка · Дом · Взрослые.*эталон — нет, база — да$/,
  },
  {
    title: 'нет политики создания покупок — ребёнок не добавит молоко в общий список',
    sql: 'DROP POLICY shopping_items_insert ON shopping_items',
    operation: 'create',
    types: ['shopping_item'],
    expected: /^Вера · создание · покупка · Дом · Вся семья.*эталон — да, база — нет$/,
  },
  {
    title: 'восстановление дел без проверки автора — взрослый восстанавливает чужое',
    sql: `ALTER POLICY tasks_update ON tasks USING (
      (deleted_at IS NULL AND ${canWriteSql('task')}) OR (deleted_at IS NOT NULL AND ${canTrashSql()}))`,
    operation: 'restore',
    types: ['task'],
    expected:
      /^Борис · восстановление из корзины · дело · Дом · .* · автор Анна .*эталон — нет, база — да$/,
  },
  {
    title: 'RLS на заметках выключена — посторонний видит всё',
    sql: 'ALTER TABLE notes DISABLE ROW LEVEL SECURITY',
    operation: 'list',
    types: ['note'],
    expected:
      /^Глеб · список без фильтра в коде · заметка · личное \(Анна\).*эталон — нет, база — да$/,
  },
  {
    title: 'нет триггера даты корзины — взрослый отдаёт чужую заметку обработчику задним числом',
    sql: 'DROP TRIGGER notes_trash_time ON notes',
    operation: 'delete',
    types: ['note'],
    expected:
      /^Борис · удаление мимо корзины.* · заметка · Дом · Вся семья · автор Анна .*эталон — нет, база — да$/,
  },
  {
    title: 'нет триггера защиты записи — взрослый правит запись в корзине, не восстанавливая',
    sql: 'DROP TRIGGER notes_guard ON notes',
    operation: 'edit',
    types: ['note'],
    expected:
      /^Анна · изменение · заметка · Дом · Вся семья · автор Анна · ответственный Анна · в корзине: эталон — нет, база — да$/,
  },
  {
    title: 'создание дел без проверки автора — Борис создаёт дело от имени Анны',
    sql: `ALTER POLICY tasks_insert ON tasks WITH CHECK (deleted_at IS NULL AND ${canWriteSql('task')})`,
    operation: 'create',
    types: ['task'],
    expected:
      /^Борис · создание · дело · Дом · Вся семья · автор Анна · ответственный Анна · создаёт Борис: эталон — нет, база — да$/,
  },
  {
    title: 'нет триггера истории — изменения записей не записываются',
    sql: 'DROP TRIGGER notes_history ON notes',
    beforeSeed: true,
    operation: 'history',
    types: ['note'],
    expected:
      /^Анна · чтение истории изменений по id записи · заметка · Дом · Вся семья.*эталон — да, база — нет$/,
  },
  {
    title: 'история читается всеми — ребёнок видит, что менялось во «Взрослых»',
    sql: 'ALTER POLICY notes_history_select ON notes_history USING (true)',
    operation: 'history',
    types: ['note'],
    expected:
      /^Вера · чтение истории изменений по id записи · заметка · Дом · Взрослые.*эталон — нет, база — да$/,
  },
  {
    title: 'автора записи можно переписать — право выдано, а триггера защиты нет',
    sql: 'GRANT UPDATE (author_id) ON notes TO homecrm_app; DROP TRIGGER notes_guard ON notes',
    operation: 'rewrite',
    types: ['note'],
    expected:
      /^Борис · подмена автора, времени создания и id · заметка · Дом · Вся семья · автор Борис .* · автор: эталон — нет, база — да$/,
  },
  {
    title: 'нет проверки canMove — взрослый уносит чужую заметку в личное',
    sql: 'DROP TRIGGER notes_guard ON notes',
    operation: 'move',
    types: ['note'],
    expected:
      /^Борис · перенос в другое место · заметка · Дом · Вся семья · автор Анна .* → заметка · личное \(Борис\).*эталон — нет, база — да$/,
  },
];

const family = buildFamily();
let database: TestDatabase | undefined;

afterEach(async () => {
  await database?.drop();
  database = undefined;
});

describe('матрица находит испорченную политику', () => {
  for (const mutation of MUTATIONS) {
    it(mutation.title, async () => {
      database = await createTestDatabase(inject('pgAdminUrl'));
      // Политики и триггеры меняет их владелец — так же, как это сделала бы ошибочная миграция.
      if (mutation.beforeSeed === true) await database.owner.query(mutation.sql);
      await seedFamily(database.admin, family);
      if (mutation.beforeSeed !== true) await database.owner.query(mutation.sql);

      const report = await runMatrix(
        createAppDatabase(database.app),
        family,
        mutation.operation,
        mutation.types,
      );
      expect(report.mismatches.length).toBeGreaterThan(0);
      expect(report.mismatches.some((line) => mutation.expected.test(line))).toBe(true);
    });
  }
});
