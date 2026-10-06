// Схема базы: учётные записи, пространства, участники дома, три таблицы-примера с общими полями
// доступа (проверка 0.4; ADR-0004, план 2.4) и таблицы входа (проверка 0.3; ADR-0005).
// Миграции создаёт drizzle-kit: `pnpm --filter @homecrm/db generate`.
//
// Политики RLS — для трёх ролей: homecrm_app (приложение), homecrm_worker (обработчик) и
// homecrm_auth (служба входа). У владельца таблиц homecrm_owner политик нет, а FORCE ROW LEVEL
// SECURITY (миграции 0002 и 0005) не даёт ему обойти RLS: он не видит ни одной строки.
import { AUDIENCES, type Placement, ROLES } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  CURRENT_ACCOUNT_SQL,
  canInviteSql,
  canResetPasswordSql,
  EXPIRED_TRASH_SQL,
  INVITATION_TTL,
  ownAccountSql,
  type RecordType,
  recordPolicySql,
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

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

const ME = CURRENT_ACCOUNT_SQL;

type PolicyCommand = 'select' | 'insert' | 'update' | 'delete';

/**
 * Политики службы входа (роль homecrm_auth) на таблице входа. Служба находит учётную запись и
 * сессию до того, как известно, чья это учётная запись, поэтому условия не привязаны к участнику
 * (`true`); защищают таблицы права ролей: службе не выдано ничего из таблиц данных, а приложению —
 * ничего из таблиц с паролями, секретами и сессиями. Узкие условия там, где они возможны, — свои.
 */
function authPolicies(table: string, commands: readonly PolicyCommand[]) {
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
    pgPolicy('accounts_select', { for: 'select', to: appRole, using: sql.raw(`id = ${ME}`) }),
    ...authPolicies('accounts', ['select', 'insert', 'update']),
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
    // Служба входа создаёт личное пространство вместе с учётной записью (SPACE-1) и дом при первой настройке.
    ...authPolicies('spaces', ['select', 'insert']),
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
    // Служба входа добавляет участника по приглашению и проверяет, чьим администратором является
    // тот, кто просит сбросить пароль (AUTH-5); данных семьи у неё нет.
    ...authPolicies('space_members', ['select', 'insert']),
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
