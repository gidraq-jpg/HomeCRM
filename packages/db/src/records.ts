// Образец таблицы записей пользователя (ADR-0004, план 2.4, PRD раздел 12).
//
// Новая сущность подключается в два шага — и ничего больше:
//   1. в schema.ts один вызов `recordTable(имя, вид, { свои колонки })` — общие поля, ограничения,
//      политики RLS, таблица истории `<имя>_history`;
//   2. в миграции после CREATE TABLE строка `SELECT app.attach_record_table('<имя>');` (для дочерней
//      таблицы — вторым аргументом имя родителя): FORCE RLS, права ролей, триггеры.
// Вид записи (`RecordType`) добавляется в access-sql.ts вместе с правилами для него в access.ts.
// Забыть шаг нельзя: `records.test.ts` сверяет каталог базы с этим перечнем, а матрица доступа
// берёт таблицы из него же — новая таблица попадает в матрицу сама.

import { getTableName, sql } from 'drizzle-orm';
import type { PgColumnBuilderBase, PgTable } from 'drizzle-orm/pg-core';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  adminAssigneeSql,
  canViewSql,
  EXPIRED_TRASH_SQL,
  HISTORY_APP_INSERT_SQL,
  HISTORY_WORKER_INSERT_SQL,
  leftAssigneeSql,
  type RecordType,
  recordPolicySql,
} from './access-sql.ts';
import {
  accounts,
  appRole,
  audienceEnum,
  createdAt,
  id,
  spaceKindEnum,
  spaceMembers,
  spaces,
  updatedAt,
  workerRole,
} from './core.ts';

/** Что произошло с записью: так её видит человек в истории (OBJ-6). */
export const HISTORY_OPERATIONS = [
  'create',
  'update',
  'trash',
  'restore',
  'move',
  'audience',
] as const;
export type HistoryOperation = (typeof HISTORY_OPERATIONS)[number];
export const historyOperationEnum = pgEnum('history_operation', HISTORY_OPERATIONS);

/** Общие поля любой записи (PRD, раздел 12; план 2.4). */
export const recordColumns = () => ({
  id: id(),
  spaceId: uuid('space_id').notNull(),
  spaceKind: spaceKindEnum('space_kind').notNull(),
  /** Аудитория — только у записи общего пространства: «Вся семья» или «Взрослые». */
  audience: audienceEnum('audience'),
  /** Автор — тот, кто создал запись; при вставке это текущий участник, потом он не меняется. */
  authorId: uuid('author_id')
    .notNull()
    .references(() => accounts.id),
  /**
   * Ответственный по правилу 9 (PRD 7.3): в личном всегда владелец, в общем — назначенный или автор,
   * для «Взрослых» — только взрослый. Триггер `<таблица>_defaults` подставляет значение,
   * внешние ключи по generated-колонкам ниже проверяют, что он состоит в доме.
   */
  assigneeId: uuid('assignee_id').references(() => accounts.id),
  title: text('title').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /** Отметка удаления: запись в корзине (DATA-1). Время ставит база. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // Ключи для внешних ключей ответственного. Внешние ключи проверяются в обход RLS, поэтому
  // база знает, кто состоит в доме и кто взрослый, хотя приложение чужих участников не видит.
  /** Ответственный записи общего пространства. */
  assigneeHouseId: uuid('assignee_house_id').generatedAlwaysAs(
    sql`CASE WHEN space_kind = 'household' THEN assignee_id END`,
  ),
  /** Ответственный записи «Взрослые» — он обязан быть взрослым. */
  assigneeAdultId: uuid('assignee_adult_id').generatedAlwaysAs(
    sql`CASE WHEN audience = 'adults' THEN assignee_id END`,
  ),
  assigneeAdultFlag: boolean('assignee_adult_flag').generatedAlwaysAs(
    sql`CASE WHEN audience = 'adults' AND assignee_id IS NOT NULL THEN true END`,
  ),
});

type CommonColumns = Record<
  | 'spaceId'
  | 'spaceKind'
  | 'audience'
  | 'assigneeHouseId'
  | 'assigneeAdultId'
  | 'assigneeAdultFlag'
  | 'deletedAt'
  | 'id',
  AnyPgColumn
>;

/** Ограничения, индексы и политики записи: одинаковые для всех таблиц, кроме правил вида записи. */
function recordRules(name: string, type: RecordType, t: CommonColumns, hasParent: boolean) {
  const policy = recordPolicySql(type);
  return [
    foreignKey({
      name: `${name}_space_fk`,
      columns: [t.spaceId, t.spaceKind],
      foreignColumns: [spaces.id, spaces.kind],
    }),
    // Ответственный состоит в этом доме (правило 9); для «Взрослых» — ещё и взрослый (PRD 7.3.4).
    foreignKey({
      name: `${name}_assignee_member_fk`,
      columns: [t.spaceId, t.assigneeHouseId],
      foreignColumns: [spaceMembers.spaceId, spaceMembers.accountId],
    }),
    foreignKey({
      name: `${name}_assignee_adult_fk`,
      columns: [t.spaceId, t.assigneeAdultId, t.assigneeAdultFlag],
      foreignColumns: [spaceMembers.spaceId, spaceMembers.accountId, spaceMembers.isAdult],
    }),
    check(
      `${name}_audience_iff_household`,
      sql.raw(`(space_kind = 'personal') = (audience IS NULL)`),
    ),
    // Цели составных внешних ключей: истории и дочерних записей — они держатся за место записи.
    unique(`${name}_id_space_key`).on(t.id, t.spaceId, t.spaceKind),
    unique(`${name}_id_audience_key`).on(t.id, t.audience),
    index(`${name}_space_id_idx`).on(t.spaceId),
    // Очистка корзины ищет только записи в корзине.
    index(`${name}_trash_idx`).on(t.deletedAt).where(sql.raw('deleted_at IS NOT NULL')),
    ...(hasParent ? [index(`${name}_parent_id_idx`).on(sql.raw('parent_id'))] : []),
    pgPolicy(`${name}_select`, { for: 'select', to: appRole, using: sql.raw(policy.select) }),
    pgPolicy(`${name}_insert`, { for: 'insert', to: appRole, withCheck: sql.raw(policy.insert) }),
    pgPolicy(`${name}_update`, {
      for: 'update',
      to: appRole,
      using: sql.raw(policy.updateUsing),
      withCheck: sql.raw(policy.updateCheck),
    }),
    // Обработчик видит и удаляет только то, что пролежало в корзине дольше срока хранения.
    pgPolicy(`${name}_purge_select`, {
      for: 'select',
      to: workerRole,
      using: sql.raw(EXPIRED_TRASH_SQL),
    }),
    pgPolicy(`${name}_purge`, {
      for: 'delete',
      to: workerRole,
      using: sql.raw(EXPIRED_TRASH_SQL),
    }),
    // Ответственный ушёл из дома: обработчик передаёт запись администратору (PRD 7.3.12).
    pgPolicy(`${name}_reassign_select`, {
      for: 'select',
      to: workerRole,
      using: sql.raw(leftAssigneeSql(name)),
    }),
    pgPolicy(`${name}_reassign`, {
      for: 'update',
      to: workerRole,
      using: sql.raw(leftAssigneeSql(name)),
      withCheck: sql.raw(adminAssigneeSql(name)),
    }),
  ];
}

export interface RecordTableOptions {
  /** Родитель дочерней таблицы (PRD 7.3.3). В `extra` обязательна колонка `parentId: uuid('parent_id').notNull()`. */
  parent?: PgTable;
}

export interface RecordDefinition {
  name: string;
  type: RecordType;
  /** Имя таблицы-родителя, если запись дочерняя. */
  parent: string | null;
}

/** Все таблицы записей, объявленные через `recordTable`: по ним сверяется каталог базы. */
export const RECORD_DEFINITIONS: RecordDefinition[] = [];

/**
 * Таблица записей пользователя: общие поля, ограничения, политики RLS и таблица истории изменений.
 * Возвращает обе таблицы; обе экспортируются из schema.ts, иначе drizzle-kit их не увидит.
 */
export function recordTable<
  TName extends string,
  TExtra extends Record<string, PgColumnBuilderBase>,
>(name: TName, type: RecordType, extra: TExtra, options: RecordTableOptions = {}) {
  const parentName = options.parent === undefined ? null : getTableName(options.parent);
  RECORD_DEFINITIONS.push({ name, type, parent: parentName });
  const table = pgTable(name, { ...recordColumns(), ...extra }, (t) =>
    recordRules(name, type, t as unknown as CommonColumns, parentName !== null),
  );
  const history = historyTable(name, table);
  return { table, history };
}

/**
 * История изменений записи (OBJ-6): кто, когда и какие поля — со старыми и новыми значениями.
 * - Пишет только триггер `<таблица>_history`: у приложения нет права вставки вне триггера
 *   (`pg_trigger_depth() > 0` в политике), права на изменение и удаление нет вовсе.
 * - Видна тем же, кому видна запись: место события (пространство, аудитория) повторяет место
 *   записи, а составные внешние ключи с каскадом переносят его вместе с записью — при переносе и
 *   смене аудитории история следует за записью и не остаётся там, где её уже не должны видеть.
 * - Уходит вместе с записью: ON DELETE CASCADE, когда обработчик очищает корзину.
 * - Событий личных записей нет: история ведётся у общих (PRD, OBJ-6).
 */
function historyTable(
  name: string,
  table: { id: AnyPgColumn; spaceId: AnyPgColumn; spaceKind: AnyPgColumn; audience: AnyPgColumn },
) {
  const historyName = `${name}_history`;
  return pgTable(
    historyName,
    {
      id: id(),
      recordId: uuid('record_id').notNull(),
      spaceId: uuid('space_id').notNull(),
      spaceKind: spaceKindEnum('space_kind').notNull(),
      audience: audienceEnum('audience'),
      /** Кто изменил; NULL — система (обработчик). */
      actorId: uuid('actor_id').references(() => accounts.id),
      createdAt: createdAt(),
      operation: historyOperationEnum('operation').notNull(),
      /** Изменённые поля: `{ "поле": { "old": …, "new": … } }`; у создания — только `new`. */
      changes: jsonb('changes').notNull(),
    },
    (t) => [
      foreignKey({
        name: `${historyName}_record_fk`,
        columns: [t.recordId, t.spaceId, t.spaceKind],
        foreignColumns: [table.id, table.spaceId, table.spaceKind],
      })
        .onUpdate('cascade')
        .onDelete('cascade'),
      foreignKey({
        name: `${historyName}_audience_fk`,
        columns: [t.recordId, t.audience],
        foreignColumns: [table.id, table.audience],
      })
        .onUpdate('cascade')
        .onDelete('cascade'),
      index(`${historyName}_record_id_idx`).on(t.recordId, t.createdAt),
      pgPolicy(`${historyName}_select`, {
        for: 'select',
        to: appRole,
        using: sql.raw(canViewSql()),
      }),
      pgPolicy(`${historyName}_insert`, {
        for: 'insert',
        to: appRole,
        withCheck: sql.raw(HISTORY_APP_INSERT_SQL),
      }),
      pgPolicy(`${historyName}_worker_insert`, {
        for: 'insert',
        to: workerRole,
        withCheck: sql.raw(HISTORY_WORKER_INSERT_SQL),
      }),
    ],
  );
}
