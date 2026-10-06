// Ядро схемы: роли базы, перечисления, учётные записи, пространства и участники дома.
// От этих таблиц зависят и записи пользователя (records.ts), и таблицы входа (schema.ts).
// Миграции создаёт drizzle-kit: `pnpm --filter @homecrm/db generate`.
import { AUDIENCES, type Placement, ROLES } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
  ACCOUNTS_SELECT_SQL,
  MEMBER_LEAVE_CHECK_SQL,
  MEMBERS_SELECT_SQL,
  SPACES_SELECT_SQL,
} from './access-sql.ts';

// Роли создаёт bootstrap.ts до миграций; здесь — только ссылки на них.
export const appRole = pgRole('homecrm_app').existing();
export const workerRole = pgRole('homecrm_worker').existing();
export const authRole = pgRole('homecrm_auth').existing();

export const SPACE_KINDS = [
  'personal',
  'household',
] as const satisfies readonly Placement['kind'][];

export const spaceKindEnum = pgEnum('space_kind', SPACE_KINDS);
export const memberRoleEnum = pgEnum('member_role', ROLES);
export const audienceEnum = pgEnum('audience', AUDIENCES);

export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

type PolicyCommand = 'select' | 'insert' | 'update' | 'delete';

/**
 * Политики службы входа (роль homecrm_auth) на таблице входа. Служба находит учётную запись и
 * сессию до того, как известно, чья это учётная запись, поэтому условия не привязаны к участнику
 * (`true`); защищают таблицы права ролей: службе не выдано ничего из таблиц данных, а приложению —
 * ничего из таблиц с паролями, секретами и сессиями. Узкие условия там, где они возможны, — свои.
 */
export function authPolicies(table: string, commands: readonly PolicyCommand[]) {
  return commands.map((command) => authPolicy(`${table}_auth_${command}`, command));
}

function authPolicy(name: string, command: PolicyCommand) {
  const all = sql.raw('true');
  if (command === 'select') return pgPolicy(name, { for: 'select', to: authRole, using: all });
  if (command === 'insert') return pgPolicy(name, { for: 'insert', to: authRole, withCheck: all });
  if (command === 'update') {
    return pgPolicy(name, { for: 'update', to: authRole, using: all, withCheck: all });
  }
  return pgPolicy(name, { for: 'delete', to: authRole, using: all });
}

/**
 * Учётная запись. Она же модель user библиотеки Better Auth (ADR-0005): библиотека пишет
 * свои поля через роль homecrm_auth, приложение видит только свою строку (роль homecrm_app).
 * Личное пространство создаётся вместе с учётной записью (SPACE-1): отложенный триггер
 * `accounts_personal_space` (миграция 0002) не даёт зафиксировать транзакцию, где его нет.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    /** Имя участника для интерфейса; в библиотеке — поле name. */
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
    /**
     * Адрес почты. Ребёнку он не нужен (AUTH-9): библиотека требует адрес у каждой записи,
     * поэтому у ребёнка — служебный адрес в зоне .invalid, письма на него не уходят.
     */
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    updatedAt: updatedAt(),
    /** Имя для входа в нормализованном виде: уникальное, без учёта регистра. */
    username: text('username'),
    /** Имя для входа так, как его ввели. */
    displayUsername: text('display_username'),
    /** Второй фактор включён и подтверждён (AUTH-3). */
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  },
  (t) => [
    unique('accounts_email_key').on(t.email),
    unique('accounts_username_key').on(t.username),
    // Приложению — только своя учётная запись. Кто видит других участников дома — решается в R0.9.
    pgPolicy('accounts_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(ACCOUNTS_SELECT_SQL),
    }),
    ...authPolicies('accounts', ['select', 'insert', 'update']),
  ],
);

/**
 * Пространство: личное (владелец — одна учётная запись, SPACE-1) или общее пространство дома.
 * У одной учётной записи может быть несколько домов (SPACE-2): их связывают участники.
 */
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
    pgPolicy('spaces_select', { for: 'select', to: appRole, using: sql.raw(SPACES_SELECT_SQL) }),
    // Служба входа создаёт личное пространство вместе с учётной записью (SPACE-1) и дом при первой настройке.
    ...authPolicies('spaces', ['select', 'insert']),
  ],
);

/**
 * Участник дома с ролью. У личного пространства участников нет: только владелец.
 * Ушедший или исключённый остаётся строкой с left_at (SPACE-8, SPACE-9): доступ к дому он теряет,
 * а его записи остаются в доме, и о них известно, кто автор («бывший участник», PRD 7.3.12).
 */
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
    /** Когда участник покинул дом или был исключён; NULL — участник действующий. */
    leftAt: timestamp('left_at', { withTimezone: true }),
    /** Кто это сделал: сам участник или администратор. Правило проверяет политика службы входа. */
    leftBy: uuid('left_by').references(() => accounts.id),
    /**
     * Взрослый или администратор. Нужен внешнему ключу записей: ответственным за запись «Взрослые»
     * может быть только взрослый, а внешние ключи проверяются в обход RLS (PRD 7.3.9).
     */
    isAdult: boolean('is_adult').generatedAlwaysAs(sql`role IN ('admin', 'adult')`),
  },
  (t) => [
    primaryKey({ columns: [t.spaceId, t.accountId] }),
    foreignKey({
      name: 'space_members_space_fk',
      columns: [t.spaceId, t.spaceKind],
      foreignColumns: [spaces.id, spaces.kind],
    }),
    unique('space_members_adult_key').on(t.spaceId, t.accountId, t.isAdult),
    check('space_members_household_only', sql.raw(`space_kind = 'household'`)),
    check('space_members_left_pair', sql.raw(`(left_at IS NULL) = (left_by IS NULL)`)),
    index('space_members_account_id_idx').on(t.accountId),
    // Только свои членства. Политика не читает space_members сама: иначе была бы рекурсия.
    pgPolicy('space_members_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(MEMBERS_SELECT_SQL),
    }),
    // Служба входа добавляет участника по приглашению и проверяет, чьим администратором является
    // тот, кто просит сбросить пароль (AUTH-5); данных семьи у неё нет.
    ...authPolicies('space_members', ['select', 'insert']),
    // Уход и исключение: право UPDATE выдано только на left_at и left_by, строка — только действующая.
    pgPolicy('space_members_auth_leave', {
      for: 'update',
      to: authRole,
      using: sql.raw('left_at IS NULL'),
      withCheck: sql.raw(MEMBER_LEAVE_CHECK_SQL),
    }),
    // Обработчик передаёт записи ушедшего администратору и ищет его по составу дома.
    pgPolicy('space_members_worker_select', {
      for: 'select',
      to: workerRole,
      using: sql.raw('true'),
    }),
  ],
);
