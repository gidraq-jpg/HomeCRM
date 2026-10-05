// Схема базы для проверки 0.4: учётные записи, пространства, участники и три таблицы-примера
// с общими полями доступа (ADR-0004, план 2.4). Миграции создаёт drizzle-kit: `pnpm --filter @homecrm/db generate`.
//
// Политики RLS — для двух ролей: homecrm_app (приложение) и homecrm_worker (обработчик).
// У владельца таблиц homecrm_owner политик нет, а FORCE ROW LEVEL SECURITY (миграция 0002)
// не даёт ему обойти RLS: он не видит ни одной строки.
import { AUDIENCES, type Placement, ROLES } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CURRENT_ACCOUNT_SQL,
  EXPIRED_TRASH_SQL,
  type RecordType,
  recordPolicySql,
} from './access-sql.ts';

// Роли создаёт bootstrap.ts до миграций; здесь — только ссылки на них.
export const appRole = pgRole('homecrm_app').existing();
export const workerRole = pgRole('homecrm_worker').existing();

export const SPACE_KINDS = [
  'personal',
  'household',
] as const satisfies readonly Placement['kind'][];

export const spaceKindEnum = pgEnum('space_kind', SPACE_KINDS);
export const memberRoleEnum = pgEnum('member_role', ROLES);
export const audienceEnum = pgEnum('audience', AUDIENCES);

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

const ME = CURRENT_ACCOUNT_SQL;

/** Учётная запись — заглушка без входа: вход появится в задаче 0.3. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
  },
  () => [
    // Пока только своя учётная запись. Кто видит других участников дома — решается в R0.9.
    pgPolicy('accounts_select', { for: 'select', to: appRole, using: sql.raw(`id = ${ME}`) }),
  ],
);

/** Пространство: личное (владелец — одна учётная запись, SPACE-1) или общее пространство дома. */
export const spaces = pgTable(
  'spaces',
  {
    id: id(),
    kind: spaceKindEnum('kind').notNull(),
    name: text('name').notNull(),
    ownerAccountId: uuid('owner_account_id').references(() => accounts.id),
    createdAt: createdAt(),
  },
  (t) => [
    // Цель составных внешних ключей (space_id, space_kind): вид пространства в записи всегда верен.
    unique('spaces_id_kind_key').on(t.id, t.kind),
    unique('spaces_owner_account_id_key').on(t.ownerAccountId),
    check(
      'spaces_owner_iff_personal',
      sql.raw(`(kind = 'personal') = (owner_account_id IS NOT NULL)`),
    ),
    pgPolicy('spaces_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(
        `owner_account_id = ${ME} OR id IN (SELECT m.space_id FROM space_members m WHERE m.account_id = ${ME})`,
      ),
    }),
  ],
);

/** Участник дома с ролью. У личного пространства участников нет: только владелец. */
export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id').notNull(),
    spaceKind: spaceKindEnum('space_kind').notNull().default('household'),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    role: memberRoleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.accountId] }),
    foreignKey({
      name: 'space_members_space_fk',
      columns: [t.spaceId, t.spaceKind],
      foreignColumns: [spaces.id, spaces.kind],
    }),
    check('space_members_household_only', sql.raw(`space_kind = 'household'`)),
    index('space_members_account_id_idx').on(t.accountId),
    // Только свои членства. Политика не читает space_members сама: иначе была бы рекурсия.
    pgPolicy('space_members_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(`account_id = ${ME}`),
    }),
  ],
);

/** Общие поля доступа любой записи (PRD, раздел 12; план 2.4). */
const recordColumns = () => ({
  id: id(),
  spaceId: uuid('space_id').notNull(),
  spaceKind: spaceKindEnum('space_kind').notNull(),
  /** Аудитория — только у записи общего пространства: «Вся семья» или «Взрослые». */
  audience: audienceEnum('audience'),
  authorId: uuid('author_id')
    .notNull()
    .references(() => accounts.id),
  /** Ответственный; у дела — исполнитель. */
  assigneeId: uuid('assignee_id').references(() => accounts.id),
  title: text('title').notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** Отметка удаления: запись в корзине. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/** Ограничения и политики записи: одинаковые для всех таблиц, кроме правила для ребёнка. */
function recordRules<TName extends string>(
  table: TName,
  type: RecordType,
  t: {
    spaceId: AnyPgColumn<{ tableName: TName }>;
    spaceKind: AnyPgColumn<{ tableName: TName }>;
  },
) {
  const policy = recordPolicySql(type);
  return [
    foreignKey({
      name: `${table}_space_fk`,
      columns: [t.spaceId, t.spaceKind],
      foreignColumns: [spaces.id, spaces.kind],
    }),
    check(
      `${table}_audience_iff_household`,
      sql.raw(`(space_kind = 'personal') = (audience IS NULL)`),
    ),
    index(`${table}_space_id_idx`).on(t.spaceId),
    pgPolicy(`${table}_select`, { for: 'select', to: appRole, using: sql.raw(policy.select) }),
    pgPolicy(`${table}_insert`, { for: 'insert', to: appRole, withCheck: sql.raw(policy.insert) }),
    pgPolicy(`${table}_update`, {
      for: 'update',
      to: appRole,
      using: sql.raw(policy.updateUsing),
      withCheck: sql.raw(policy.updateCheck),
    }),
    // Обработчик видит и удаляет только то, что пролежало в корзине дольше срока хранения.
    pgPolicy(`${table}_purge_select`, {
      for: 'select',
      to: workerRole,
      using: sql.raw(EXPIRED_TRASH_SQL),
    }),
    pgPolicy(`${table}_purge`, {
      for: 'delete',
      to: workerRole,
      using: sql.raw(EXPIRED_TRASH_SQL),
    }),
  ];
}

/** Заметки: личные и общие. Ребёнок в общем пространстве их не пишет. */
export const notes = pgTable(
  'notes',
  {
    ...recordColumns(),
    body: text('body').notNull().default(''),
  },
  (t) => recordRules('notes', 'note', t),
);

/** Покупки: ребёнок может писать в общий список. */
export const shoppingItems = pgTable(
  'shopping_items',
  {
    ...recordColumns(),
    quantity: text('quantity'),
    boughtAt: timestamp('bought_at', { withTimezone: true }),
  },
  (t) => recordRules('shopping_items', 'shopping_item', t),
);

/** Дела: ребёнок пишет только дела, где исполнитель — он. */
export const tasks = pgTable(
  'tasks',
  {
    ...recordColumns(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
  },
  (t) => recordRules('tasks', 'task', t),
);

/** Таблица-пример для каждого вида записи. */
export const RECORD_TABLES = {
  note: notes,
  shopping_item: shoppingItems,
  task: tasks,
} as const satisfies Record<RecordType, unknown>;
