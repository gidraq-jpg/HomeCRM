// Паспорт сущности (ADR-0054): каждая таблица с пользовательскими данными записана здесь вместе
// с решениями по доступу, RLS, матрице, поиску, экспорту и корзине. Служебные таблицы — в
// SERVICE_TABLES. Тест entities.test.ts сверяет реестр со свежей базой после всех миграций:
// таблица без паспорта, несуществующая политика или неподтверждённое решение роняют тест.
import type { ExportRecords } from '@homecrm/shared';

/**
 * Явное исключение. `no` — осознанное решение со ссылкой на требование PRD (`DATA-2`) или ADR
 * (`ADR-0027`). `gap` — пробел или вопрос без записанного решения: тест его пропускает, но падает,
 * если пробел уже закрыт, — тогда исключение убирают из реестра.
 */
export type EntityException = { no: string; ref: string } | { gap: string };

export type EntityAccess =
  /** Свои поля доступа: space_id, space_kind, audience, author_id, assignee_id, deleted_at. */
  | 'own'
  /** Строка принадлежит записи родителя и видна по её правилам. */
  | { inherits: string; via: string }
  /** Особая модель доступа: перечисленные колонки и правило со ссылкой на решение. */
  | { columns: readonly string[]; rule: string; ref: string };

export interface EntityPassport {
  table: string;
  access: EntityAccess;
  /** Политика чтения RLS; тест проверяет, что она есть и RLS включён принудительно. */
  policy: string;
  /** Файл матрицы доступа в packages/db/src; общая матрица записей — access-matrix.test.ts. */
  matrix: string;
  /** 'indexed' — у таблицы есть триггер app.sync_search_entry. */
  search: 'indexed' | EntityException;
  /** Раздел ZIP-архива из ExportRecords; таблица встречается в коде архива. */
  export: { section: keyof typeof ExportRecords } | EntityException;
  /** 'soft' — отметка deleted_at, корзина 30 дней (DATA-1); withParent — уходит с родителем по FK. */
  trash: 'soft' | { withParent: string } | { no: string; ref?: string };
}

const RECORD_MATRIX = 'access-matrix.test.ts';
const FILES_NOT_SEARCHED = {
  no: 'имя и содержимое файла не индексируются: поиск ведёт к родительской карточке',
  ref: 'ADR-0024',
} as const;

/** Запись по общему механизму recordTable: свои поля доступа, история, корзина, общая матрица. */
function record(
  table: string,
  search: EntityPassport['search'],
  options: { trash?: EntityPassport['trash']; export?: EntityPassport['export'] } = {},
): EntityPassport {
  return {
    table,
    access: 'own',
    policy: `${table}_select`,
    matrix: RECORD_MATRIX,
    search,
    export: options.export ?? { section: table as keyof typeof ExportRecords },
    trash: options.trash ?? 'soft',
  };
}

/** История изменений записи (OBJ-6): видна по правилам записи, выгружается разделом history. */
function history(
  table: string,
  exported: EntityPassport['export'] = { section: 'history' },
): EntityPassport {
  return {
    table: `${table}_history`,
    access: { inherits: table, via: 'record_id' },
    policy: `${table}_history_select`,
    matrix: RECORD_MATRIX,
    search: { no: 'автоматическая история не индексируется', ref: 'ADR-0027' },
    export: exported,
    trash: { withParent: table },
  };
}

const RECORDS: EntityPassport[] = [
  record('notes', 'indexed'),
  record('note_items', 'indexed'),
  record('note_files', FILES_NOT_SEARCHED),
  record('objects', 'indexed'),
  record('object_fields', 'indexed'),
  record('object_events', 'indexed'),
  record('object_files', FILES_NOT_SEARCHED),
  record('tasks', 'indexed'),
  record('task_files', FILES_NOT_SEARCHED),
  record('shopping_items', 'indexed'),
  record('documents', 'indexed'),
  record('document_files', FILES_NOT_SEARCHED),
  record('contacts', 'indexed'),
  record('contact_interactions', {
    no: 'тексты взаимодействий не индексируются',
    ref: 'ADR-0036',
  }),
  record('utility_accounts', {
    no: 'лицевые счета находятся через карточку объекта, отдельной выдачи в поиске нет',
    ref: 'ADR-0031',
  }),
  record('meters', 'indexed'),
  record('meter_readings', { no: 'показания отдельно не индексируются', ref: 'ADR-0032' }),
  record(
    'utility_charges',
    { no: 'начисления находятся через лицевой счёт, суммы в индекс не входят', ref: 'ADR-0034' },
    { trash: { withParent: 'utility_accounts' } },
  ),
  record(
    'utility_payments',
    { no: 'оплаты находятся через начисление, суммы в индекс не входят', ref: 'ADR-0034' },
    { trash: { withParent: 'utility_charges' } },
  ),
  record('inbox_items', { no: 'черновики входящих поиск не индексирует', ref: 'ADR-0044' }),
  record('inbox_files', { no: 'страницы и файлы входящих не индексируются', ref: 'ADR-0044' }),
];

const INBOX_HISTORY_GAP = {
  gap: 'история входящих не входит в HISTORY_TABLES архива, решения об этом нет — вопрос ведущему',
} as const;

const HISTORIES: EntityPassport[] = [
  history('notes'),
  history('note_items'),
  history('note_files'),
  history('objects'),
  history('object_fields'),
  history('object_events'),
  history('object_files'),
  history('tasks'),
  history('task_files'),
  history('shopping_items'),
  history('documents'),
  history('document_files'),
  history('contacts'),
  history('contact_interactions'),
  history('utility_accounts'),
  history('meters'),
  history('meter_readings'),
  history('utility_charges'),
  history('utility_payments'),
  history('inbox_items', INBOX_HISTORY_GAP),
  history('inbox_files', INBOX_HISTORY_GAP),
];

const SEARCH_GAP = { gap: 'решение о поиске не записано в PRD и ADR — вопрос владельцу' } as const;

const OTHERS: EntityPassport[] = [
  {
    table: 'accounts',
    access: {
      columns: ['id', 'display_name', 'email', 'username'],
      rule: 'учётная запись видна себе и участникам общих домов',
      ref: 'ADR-0005',
    },
    policy: 'accounts_select',
    matrix: 'spaces-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'profile' },
    trash: { no: 'учётная запись не уходит в корзину: колонки deleted_at нет' },
  },
  {
    table: 'member_profiles',
    access: {
      columns: ['account_id', 'display_name', 'birth_date', 'phone'],
      rule: 'профиль видят владелец и участники его действующих домов',
      ref: 'ADR-0022',
    },
    policy: 'member_profiles_select',
    matrix: 'household-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'profile' },
    trash: { no: 'поля профиля правят и очищают, сам профиль не удаляется', ref: 'SPACE-10' },
  },
  {
    table: 'profile_files',
    access: {
      columns: ['account_id', 'deleted_at'],
      rule: 'файлы видит владелец, семья — только выбранное живое фото',
      ref: 'ADR-0026',
    },
    policy: 'profile_files_select',
    matrix: 'profile-files-matrix.test.ts',
    search: { no: 'фото профиля не включается в поиск', ref: 'ADR-0026' },
    export: { section: 'profile_files' },
    trash: 'soft',
  },
  {
    table: 'spaces',
    access: {
      columns: ['id', 'kind', 'owner_account_id'],
      rule: 'личное пространство видит владелец, дом — его участники',
      ref: 'SPACE-1',
    },
    policy: 'spaces_select',
    matrix: 'spaces-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'household' },
    trash: { no: 'пространство не удаляется: оно существует, пока есть учётная запись или дом' },
  },
  {
    table: 'space_members',
    access: {
      columns: ['space_id', 'account_id', 'role', 'left_at'],
      rule: 'состав дома видят его участники; уход отмечается left_at, а не удалением',
      ref: 'SPACE-8',
    },
    policy: 'space_members_select',
    matrix: 'spaces-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'members' },
    trash: { no: 'уход из дома отмечается left_at', ref: 'SPACE-9' },
  },
  {
    table: 'notification_settings',
    access: {
      columns: ['account_id'],
      rule: 'настройки видит и меняет только владелец',
      ref: 'ADR-0029',
    },
    policy: 'notification_settings_own_select',
    matrix: 'notifications-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'notification_settings' },
    trash: { no: 'настройки не удаляются, только меняются' },
  },
  {
    table: 'record_links',
    access: {
      columns: ['left_table', 'left_id', 'right_table', 'right_id', 'author_id', 'deleted_at'],
      rule: 'связь видна, когда видны оба её конца',
      ref: 'ADR-0023',
    },
    policy: 'record_links_select',
    matrix: 'objects-matrix.test.ts',
    search: SEARCH_GAP,
    export: { section: 'record_links' },
    trash: 'soft',
  },
  {
    table: 'deadlines',
    access: 'own',
    policy: 'deadlines_select',
    matrix: 'deadlines-matrix.test.ts',
    search: { no: 'правила без своих текстов, источник уже индексирован', ref: 'ADR-0028' },
    export: { section: 'deadlines' },
    trash: 'soft',
  },
  {
    table: 'deadline_occurrences',
    access: 'own',
    policy: 'deadline_occurrences_select',
    matrix: 'deadlines-matrix.test.ts',
    search: { no: 'наступления производные и без текстов', ref: 'ADR-0028' },
    export: { section: 'deadline_completions' },
    trash: { withParent: 'deadlines' },
  },
  {
    table: 'radar_actions',
    access: 'own',
    policy: 'radar_actions_select',
    matrix: 'radar-summaries-matrix.test.ts',
    search: { no: 'причины действий не индексируются', ref: 'ADR-0040' },
    export: { section: 'radar_actions' },
    trash: { withParent: 'deadlines' },
  },
  {
    table: 'summaries',
    access: {
      columns: ['account_id', 'household_id'],
      rule: 'сводку видит только получатель, администратор чужих не видит',
      ref: 'ADR-0040',
    },
    policy: 'summaries_select',
    matrix: 'radar-summaries-matrix.test.ts',
    search: { no: 'сводка не хранит названий и текстов', ref: 'ADR-0040' },
    export: { section: 'summaries' },
    trash: { no: 'сводки удаляются вместе с учётной записью или домом', ref: 'ADR-0040' },
  },
  {
    table: 'export_events',
    access: {
      columns: ['account_id', 'kind', 'household_id'],
      rule: 'личные выгрузки видит владелец, выгрузки дома — его администраторы',
      ref: 'ADR-0030',
    },
    policy: 'export_events_select',
    matrix: 'export-matrix.test.ts',
    search: { no: 'журнал экспорта технический, без поиска', ref: 'ADR-0030' },
    export: { section: 'export_events' },
    trash: { no: 'журнал без корзины и изменений', ref: 'ADR-0030' },
  },
  {
    table: 'chat_events',
    access: 'own',
    policy: 'chat_events_own_select',
    matrix: 'chat-matrix.test.ts',
    search: { no: 'журнал подключения чата не ищется', ref: 'ADR-0048' },
    export: { section: 'chat_events' },
    trash: { no: 'журнал без корзины', ref: 'ADR-0048' },
  },
];

export const ENTITY_REGISTRY: readonly EntityPassport[] = [...RECORDS, ...HISTORIES, ...OTHERS];

/** Таблицы без пользовательских данных: вход, очереди, журналы операций, производные индексы. */
export const SERVICE_TABLES: Readonly<Record<string, string>> = {
  'drizzle.__drizzle_migrations': 'журнал применённых миграций',
  credentials: 'вход: хеши паролей (ADR-0005)',
  sessions: 'вход: сессии',
  two_factors: 'вход: TOTP и резервные коды',
  verifications: 'вход: коды подтверждения',
  password_resets: 'вход: сбросы пароля',
  invitations: 'вход: приглашения в дом',
  login_events: 'журнал входов',
  login_locks: 'блокировки входа',
  login_name_attempts: 'блокировки по имени входа',
  rate_limits: 'ограничение частоты запросов',
  household_access: 'производная проекция членства для RLS (ADR-0022)',
  search_index: 'производный индекс поиска (ADR-0027)',
  file_blobs: 'реестр блоков хранилища без метаданных (ADR-0024)',
  deadline_notifications: 'очередь уведомлений о сроках (ADR-0028)',
  push_subscriptions: 'подписки push (ADR-0029)',
  push_deliveries: 'очередь доставки push (ADR-0029)',
  push_attempts: 'журнал попыток push (ADR-0029)',
  api_operations: 'квитанции идемпотентных операций (ADR-0041)',
  template_applications: 'квитанции применения шаблонов (ADR-0034)',
  ai_daily_usage: 'счётчик запросов к AI по дому (ADR-0043)',
  chat_clients: 'зарегистрированные клиенты чата (ADR-0048)',
  chat_codes: 'одноразовые коды подключения чата (ADR-0048)',
  chat_grants: 'ключи доступа чата; не экспортируются (ADR-0048)',
};
