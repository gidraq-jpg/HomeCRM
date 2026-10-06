// Схема базы: учётные записи, пространства и участники дома (core.ts), записи пользователя с
// общими полями доступа и историей (records.ts; здесь — таблицы-образцы по ADR-0004, план 2.4) и
// таблицы входа (ADR-0005). Миграции создаёт drizzle-kit: `pnpm --filter @homecrm/db generate`.
//
// Политики RLS — для трёх ролей: homecrm_app (приложение), homecrm_worker (обработчик) и
// homecrm_auth (служба входа). У владельца таблиц homecrm_owner политик нет, а FORCE ROW LEVEL
// SECURITY не даёт ему обойти RLS: он не видит ни одной строки.
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  canInviteSql,
  canResetPasswordSql,
  INVITATION_TTL,
  ownAccountSql,
  type RecordType,
} from './access-sql.ts';
import {
  accounts,
  appRole,
  authPolicies,
  authRole,
  createdAt,
  id,
  memberRoleEnum,
  spaceKindEnum,
  spaces,
  updatedAt,
} from './core.ts';
import { recordTable } from './records.ts';

export * from './core.ts';
export * from './records.ts';

// Таблицы-образцы записей: примеры для R0.4 и R1c, не готовые модули. Каждая — один вызов
// recordTable; всё остальное (политики, права, триггеры, история) делает помощник.

/** Заметки: личные и общие. Ребёнок в общем пространстве их не пишет. */
const notesDefinition = recordTable('notes', 'note', { body: text('body').notNull().default('') });
export const notes = notesDefinition.table;
export const notesHistory = notesDefinition.history;

/**
 * Пункты чек-листа заметки — образец дочерней таблицы (PRD 7.3.3): пространство и аудитория те же,
 * что у заметки, и шире неё запись не видна. Внешние ключи на родителя откладываются до конца
 * транзакции: заметку и её пункты переносят вместе (PRD 7.3.5).
 */
const noteItemsDefinition = recordTable(
  'note_items',
  'note_item',
  { parentId: uuid('parent_id').notNull(), done: boolean('done').notNull().default(false) },
  { parent: notes },
);
export const noteItems = noteItemsDefinition.table;
export const noteItemsHistory = noteItemsDefinition.history;

/** Покупки: ребёнок может писать в общий список. */
const shoppingItemsDefinition = recordTable('shopping_items', 'shopping_item', {
  quantity: text('quantity'),
  boughtAt: timestamp('bought_at', { withTimezone: true }),
});
export const shoppingItems = shoppingItemsDefinition.table;
export const shoppingItemsHistory = shoppingItemsDefinition.history;

/** Дела: ребёнок пишет только дела, где исполнитель — он. */
const tasksDefinition = recordTable('tasks', 'task', {
  dueAt: timestamp('due_at', { withTimezone: true }),
  doneAt: timestamp('done_at', { withTimezone: true }),
});
export const tasks = tasksDefinition.table;
export const tasksHistory = tasksDefinition.history;

/** Таблица-пример для каждого вида записи. */
export const RECORD_TABLES = {
  note: notes,
  note_item: noteItems,
  shopping_item: shoppingItems,
  task: tasks,
} as const satisfies Record<RecordType, unknown>;

/** История изменений каждого вида записи (OBJ-6). */
export const RECORD_HISTORY_TABLES = {
  note: notesHistory,
  note_item: noteItemsHistory,
  shopping_item: shoppingItemsHistory,
  task: tasksHistory,
} as const satisfies Record<RecordType, unknown>;
// ---------------------------------------------------------------------------------------------
// Таблицы входа (ADR-0005). Первые шесть — модели Better Auth: имена моделей и полей заданы в
// настройках библиотеки (apps/server/src/auth), форма таблиц проверяется там же
// (schema.test.ts). Остальные — своё: приглашения, журнал входов, блокировки, сброс пароля.
// Приложению (homecrm_app) пароли, секреты и сессии не выданы вовсе: права на эти таблицы
// есть только у службы входа (homecrm_auth).
// ---------------------------------------------------------------------------------------------

/** Сессия на устройстве (AUTH-6): срок до 90 дней, продлевается при использовании. */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('sessions_token_key').on(t.token),
    index('sessions_user_id_idx').on(t.userId),
    ...authPolicies('sessions', ['select', 'insert', 'update', 'delete']),
  ],
);

/**
 * Способ входа учётной записи; в библиотеке — модель account. Пароль — хэш Argon2id в поле
 * password у строки с providerId = 'credential'. Поля OAuth библиотека описывает в своей схеме,
 * но не использует: внешних поставщиков входа нет (ADR-0005).
 */
export const credentials = pgTable(
  'credentials',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    password: text('password'),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('credentials_user_id_idx').on(t.userId),
    // Один пароль на учётную запись.
    uniqueIndex('credentials_one_password_idx')
      .on(t.userId)
      .where(sql.raw(`provider_id = 'credential'`)),
    ...authPolicies('credentials', ['select', 'insert', 'update']),
  ],
);

/** Одноразовые значения библиотеки: ссылки сброса пароля, незавершённый вход со вторым фактором. */
export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('verifications_identifier_idx').on(t.identifier),
    ...authPolicies('verifications', ['select', 'insert', 'update', 'delete']),
  ],
);

/** Второй фактор (AUTH-3, AUTH-4): секрет TOTP и коды восстановления — зашифрованными. */
export const twoFactors = pgTable(
  'two_factors',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    /** Секрет подтверждён кодом из приложения; до этого второй фактор при входе не требуется. */
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [
    unique('two_factors_user_id_key').on(t.userId),
    ...authPolicies('two_factors', ['select', 'insert', 'update', 'delete']),
  ],
);

/** Счётчики ограничения запросов библиотеки: по адресу и пути (AUTH-8). */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: id(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    /** Миллисекунды Unix: так их хранит библиотека. */
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (t) => [
    unique('rate_limits_key_key').on(t.key),
    ...authPolicies('rate_limits', ['select', 'insert', 'update', 'delete']),
  ],
);

/**
 * Приглашение в дом с ролью (AUTH-2): одноразовая ссылка на 72 часа. В базе — только хэш
 * ссылки. Создаёт и отзывает администратор дома (роль homecrm_app, политики canInvite);
 * принимает служба входа: ей разрешено лишь отметить живое приглашение принятым.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    householdId: uuid('household_id').notNull(),
    spaceKind: spaceKindEnum('space_kind').notNull().default('household'),
    role: memberRoleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql.raw(`now() + interval '${INVITATION_TTL}'`)),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => accounts.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    unique('invitations_token_hash_key').on(t.tokenHash),
    foreignKey({
      name: 'invitations_household_fk',
      columns: [t.householdId, t.spaceKind],
      foreignColumns: [spaces.id, spaces.kind],
    }),
    index('invitations_household_id_idx').on(t.householdId),
    check('invitations_household_only', sql.raw(`space_kind = 'household'`)),
    // Срок не больше 72 часов, что бы ни прислало приложение.
    check(
      'invitations_ttl',
      sql.raw(
        `expires_at > created_at AND expires_at <= created_at + interval '${INVITATION_TTL}'`,
      ),
    ),
    check('invitations_accepted_pair', sql.raw(`(accepted_at IS NULL) = (accepted_by IS NULL)`)),
    pgPolicy('invitations_select', { for: 'select', to: appRole, using: sql.raw(canInviteSql()) }),
    pgPolicy('invitations_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql.raw(
        `${canInviteSql()} AND ${ownAccountSql('created_by')} AND accepted_at IS NULL AND revoked_at IS NULL`,
      ),
    }),
    // Отозвать можно непринятое приглашение своего дома; право UPDATE выдано только на revoked_at.
    pgPolicy('invitations_revoke', {
      for: 'update',
      to: appRole,
      using: sql.raw(`${canInviteSql()} AND accepted_at IS NULL`),
      withCheck: sql.raw(`${canInviteSql()} AND accepted_at IS NULL`),
    }),
    pgPolicy('invitations_auth_select', { for: 'select', to: authRole, using: sql.raw('true') }),
    // Принять можно только живое приглашение: срок и одноразовость держит база.
    // Право UPDATE выдано только на accepted_at и accepted_by.
    pgPolicy('invitations_auth_accept', {
      for: 'update',
      to: authRole,
      using: sql.raw(`accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`),
      withCheck: sql.raw(`accepted_at IS NOT NULL`),
    }),
  ],
);

export const LOGIN_KINDS = ['sign_in', 'second_factor', 'password_reset'] as const;
export const LOGIN_OUTCOMES = ['success', 'failure', 'locked', 'second_factor_required'] as const;
export const loginKindEnum = pgEnum('login_kind', LOGIN_KINDS);
export const loginOutcomeEnum = pgEnum('login_outcome', LOGIN_OUTCOMES);

/**
 * Журнал входов (AUTH-8): попытки по известной учётной записи — устройство, адрес, результат.
 * Участник читает только свой (canViewAccountJournal); пишет служба входа.
 */
export const loginEvents = pgTable(
  'login_events',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    kind: loginKindEnum('kind').notNull(),
    outcome: loginOutcomeEnum('outcome').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('login_events_account_id_created_at_idx').on(t.accountId, t.createdAt),
    pgPolicy('login_events_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(ownAccountSql()),
    }),
    pgPolicy('login_events_auth_insert', {
      for: 'insert',
      to: authRole,
      withCheck: sql.raw('true'),
    }),
  ],
);

/** Блокировка входа по учётной записи после серии неудачных попыток (AUTH-8). */
export const loginLocks = pgTable(
  'login_locks',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    failures: integer('failures').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  () => [...authPolicies('login_locks', ['select', 'insert', 'update', 'delete'])],
);

/**
 * Сброс пароля ребёнка администратором (AUTH-5). Строку создаёт служба входа, когда администратор
 * выдал ссылку; политика проверяет само правило (canResetPassword): администратор — только
 * ребёнку своего дома. Когда ребёнок задал новый пароль, строка отмечается выполненной, и при
 * следующем входе ребёнок видит отметку, пока не подтвердит, что прочитал её.
 */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    /** Ребёнок, чей пароль сбрасывают. */
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Администратор, выдавший ссылку. */
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Ребёнок задал новый пароль по ссылке. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Ребёнок увидел отметку о сбросе. */
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  },
  (t) => [
    index('password_resets_account_id_idx').on(t.accountId),
    check('password_resets_not_self', sql.raw('account_id <> requested_by')),
    pgPolicy('password_resets_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(ownAccountSql()),
    }),
    // Подтвердить прочтение может только сам ребёнок и только выполненный сброс; право UPDATE — на acknowledged_at.
    pgPolicy('password_resets_ack', {
      for: 'update',
      to: appRole,
      using: sql.raw(`${ownAccountSql()} AND completed_at IS NOT NULL`),
      withCheck: sql.raw(`${ownAccountSql()} AND completed_at IS NOT NULL`),
    }),
    pgPolicy('password_resets_auth_select', {
      for: 'select',
      to: authRole,
      using: sql.raw('true'),
    }),
    pgPolicy('password_resets_auth_insert', {
      for: 'insert',
      to: authRole,
      withCheck: sql.raw(canResetPasswordSql()),
    }),
    // Отметить выполненным можно один раз; право UPDATE — только на completed_at.
    pgPolicy('password_resets_auth_complete', {
      for: 'update',
      to: authRole,
      using: sql.raw('completed_at IS NULL'),
      withCheck: sql.raw('completed_at IS NOT NULL'),
    }),
  ],
);
