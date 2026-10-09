// Схема базы: учётные записи, пространства и участники дома (core.ts), записи пользователя с
// общими полями доступа и историей (records.ts; здесь — таблицы-образцы по ADR-0004, план 2.4) и
// таблицы входа (ADR-0005). Миграции создаёт drizzle-kit: `pnpm --filter @homecrm/db generate`.
//
// Политики RLS — для трёх ролей: homecrm_app (приложение), homecrm_worker (обработчик) и
// homecrm_auth (служба входа). У владельца таблиц homecrm_owner политик нет, а FORCE ROW LEVEL
// SECURITY не даёт ему обойти RLS: он не видит ни одной строки.

import {
  type ChargeLine,
  type DocumentData,
  MeterData,
  OBJECT_TYPES,
  type OrganizationData,
  type PaymentInput,
  type PersonData,
  type UtilityAccountData,
} from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgRole,
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
  DOCUMENT_VISIBLE_SQL,
  INVITATION_TTL,
  ownAccountSql,
  type RecordType,
} from './access-sql.ts';
import {
  accounts,
  appRole,
  audienceEnum,
  authPolicies,
  authRole,
  createdAt,
  id,
  memberRoleEnum,
  spaceKindEnum as originSpaceKindEnum,
  spaceKindEnum,
  spaces,
  updatedAt,
  workerRole,
} from './core.ts';
import { recordTable } from './records.ts';

export * from './core.ts';
export * from './deadlines-schema.ts';
export * from './export-schema.ts';
export * from './notifications-schema.ts';
export * from './records.ts';
export * from './search-schema.ts';

// Таблицы-образцы записей: примеры для R0.4 и R1c, не готовые модули. Каждая — один вызов
// recordTable; всё остальное (политики, права, триггеры, история) делает помощник.

/** Заметки: личные и общие. Ребёнок в общем пространстве их не пишет. */
const notesDefinition = recordTable(
  'notes',
  'note',
  {
    body: text('body').notNull().default(''),
    pinned: boolean('pinned').notNull().default(false),
    /** Будущий поиск NOTE-3; HTML не хранится (ADR-0020). */
    searchText: text('search_text').generatedAlwaysAs(sql`title || ' ' || body`),
  },
  {
    extraPolicies: [
      pgPolicy('notes_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.note_id = notes.id)`,
      }),
    ],
  },
);
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
  {
    parentId: uuid('parent_id').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
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

/** OBJ-1: поля конкретного типа появятся вместе с UTIL и DOC; пока контейнер пуст. */
export const objectTypeEnum = pgEnum('object_type', OBJECT_TYPES);
const objectsDefinition = recordTable(
  'objects',
  'object',
  {
    objectType: objectTypeEnum('object_type').notNull().default('other'),
    typeData: jsonb('type_data').notNull().default({}),
    searchText: text('search_text').generatedAlwaysAs(
      sql`title || coalesce(' ' || (type_data->>'address'),'') || coalesce(' ' || (type_data->>'cadastralNumber'),'')`,
    ),
  },
  {
    extraPolicies: [
      pgPolicy('objects_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id = objects.id)`,
      }),
    ],
  },
);
export const objects = objectsDefinition.table;
export const objectsHistory = objectsDefinition.history;

/** Название поля — общий title, значение и порядок — собственные колонки. */
const objectFieldsDefinition = recordTable(
  'object_fields',
  'object_field',
  {
    parentId: uuid('parent_id').notNull(),
    value: text('value').notNull().default(''),
    position: integer('position').notNull().default(0),
    searchText: text('search_text').generatedAlwaysAs(sql`title || ' ' || value`),
  },
  { parent: objects },
);
export const objectFields = objectFieldsDefinition.table;
export const objectFieldsHistory = objectFieldsDefinition.history;

/** Ручное событие: текст — title. Снимок места не меняется при переносе объекта. */
export const eventVisibilitySql = `
  app.placement_visible(origin_space_id, origin_space_kind, origin_audience)
  AND EXISTS (SELECT 1 FROM public.objects p WHERE p.id = parent_id)`;
// Контекст выставляет и снимает триггер родителя; прямой SQL не меняет скрытое событие.
export const eventCascadeSql = `pg_trigger_depth() > 0
  AND parent_id = nullif(current_setting('app.object_cascade_id',true),'')::uuid
  AND app.record_ref_allowed('objects',parent_id,false)
  AND (current_setting('app.object_cascade_mode',true)<>'restore' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)
  AND (current_setting('app.object_cascade_mode',true)<>'trash' OR
    deleted_at IS NULL OR deleted_at=nullif(current_setting('app.object_cascade_time',true),'')::timestamptz)`;
export const eventUpdateVisibilitySql = `((${eventVisibilitySql}) AND nullif(current_setting('app.object_cascade_id',true),'') IS NULL) OR (${eventCascadeSql})`;
// Обработчик обнуляет ссылку только внутри триггера окончательной очистки контакта.
const contactPurgeContextSql =
  "pg_trigger_depth() > 0 AND nullif(current_setting('app.contact_purge_id',true),'') IS NOT NULL";
const contactPurgeMatchSql = `contact_table = current_setting('app.contact_purge_table',true)
  AND contact_id = nullif(current_setting('app.contact_purge_id',true),'')::uuid`;
const objectEventsDefinition = recordTable(
  'object_events',
  'object_event',
  {
    parentId: uuid('parent_id').notNull(),
    occurredOn: date('occurred_on').notNull().default(sql`CURRENT_DATE`),
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }),
    rating: integer('rating'),
    contactTable: text('contact_table'),
    contactId: uuid('contact_id'),
    originSpaceId: uuid('origin_space_id').notNull(),
    originSpaceKind: originSpaceKindEnum('origin_space_kind').notNull(),
    originAudience: audienceEnum('origin_audience'),
    searchText: text('search_text').generatedAlwaysAs(sql`title`),
  },
  {
    parent: objects,
    visibleSql: eventVisibilitySql,
    updateVisibilitySql: eventUpdateVisibilitySql,
    extraPolicies: [
      // SELECT нужен ограниченному UPDATE каскада; прямой запрос не получает служебного доступа.
      pgPolicy('object_events_cascade_select', {
        for: 'select',
        to: appRole,
        using: sql.raw(eventCascadeSql),
      }),
      pgPolicy('object_events_contact_purge_select', {
        for: 'select',
        to: workerRole,
        using: sql.raw(
          `(${contactPurgeContextSql}) AND ((${contactPurgeMatchSql}) OR (contact_id IS NULL AND contact_table IS NULL))`,
        ),
      }),
      pgPolicy('object_events_contact_purge', {
        for: 'update',
        to: workerRole,
        using: sql.raw(`(${contactPurgeContextSql}) AND (${contactPurgeMatchSql})`),
        withCheck: sql.raw(
          `(${contactPurgeContextSql}) AND contact_id IS NULL AND contact_table IS NULL`,
        ),
      }),
    ],
  },
);
export const objectEvents = objectEventsDefinition.table;
export const objectEventsHistory = objectEventsDefinition.history;

/** Связь хранит два конца; её пространство и аудитория — пересечение их доступа (ADR-0023). */
const linkView = sql`app.record_ref_allowed(left_table, left_id, false) AND app.record_ref_allowed(right_table, right_id, false)`;
const linkWrite = sql`${linkView} AND (app.record_ref_allowed(left_table, left_id, true) OR app.record_ref_allowed(right_table, right_id, true))`;
export const recordLinks = pgTable(
  'record_links',
  {
    id: id(),
    leftTable: text('left_table').notNull(),
    leftId: uuid('left_id').notNull(),
    rightTable: text('right_table').notNull(),
    rightId: uuid('right_id').notNull(),
    role: text('role').notNull().default(''),
    authorId: uuid('author_id')
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('record_links_left_idx').on(t.leftTable, t.leftId),
    index('record_links_right_idx').on(t.rightTable, t.rightId),
    pgPolicy('record_links_select', { for: 'select', to: appRole, using: linkView }),
    pgPolicy('record_links_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`${linkWrite} AND author_id = app.current_account_id() AND deleted_at IS NULL`,
    }),
    pgPolicy('record_links_update', {
      for: 'update',
      to: appRole,
      using: linkWrite,
      withCheck: linkWrite,
    }),
    pgPolicy('record_links_purge_select', {
      for: 'select',
      to: workerRole,
      using: sql`deleted_at < now() - interval '30 days' OR pg_trigger_depth() > 0`,
    }),
    pgPolicy('record_links_purge', {
      for: 'delete',
      to: workerRole,
      using: sql`deleted_at < now() - interval '30 days' OR pg_trigger_depth() > 0`,
    }),
  ],
);

/** DOC-1/5: версии — самостоятельные записи с собственным доступом и историей. */
const documentsDefinition = recordTable(
  'documents',
  'document',
  {
    data: jsonb('data').$type<DocumentData>().notNull().default({
      type: 'other',
      series: '',
      number: '',
      issuedBy: '',
      issuedOn: null,
      expiresOn: null,
      indefinite: false,
      note: '',
      tags: [],
    }),
    ownerAccountId: uuid('owner_account_id').references(() => accounts.id),
    ownerContactId: uuid('owner_contact_id'),
    ownerObjectId: uuid('owner_object_id').references(() => objects.id, { onDelete: 'cascade' }),
    previousId: uuid('previous_id').references((): AnyPgColumn => documents.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<'valid' | 'invalid'>().notNull().default('valid'),
    isIdentity: boolean('is_identity').generatedAlwaysAs(
      sql`data->>'type' IN ('russian_passport','international_passport','birth_certificate','snils','inn','driver_license')`,
    ),
  },
  {
    visibleSql: DOCUMENT_VISIBLE_SQL,
    updateVisibilitySql: DOCUMENT_VISIBLE_SQL,
    extraChecks: [
      check(
        'documents_one_owner',
        sql`num_nonnulls(owner_account_id,owner_contact_id,owner_object_id)<=1`,
      ),
      check('documents_status', sql`status IN ('valid','invalid')`),
    ],
    extraPolicies: [
      pgPolicy('documents_passport_refresh', {
        for: 'select',
        to: pgRole('homecrm_owner').existing(),
        using: sql`pg_trigger_depth()>0 AND data->>'type'='russian_passport' AND (owner_account_id=nullif(current_setting('app.passport_owner_account',true),'')::uuid OR owner_contact_id=nullif(current_setting('app.passport_owner_contact',true),'')::uuid)`,
      }),
      pgPolicy('documents_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.document_id=documents.id)`,
      }),
      pgPolicy('documents_object_cascade', {
        for: 'update',
        to: appRole,
        using: sql`pg_trigger_depth()>0 AND owner_object_id=nullif(current_setting('app.document_object_id',true),'')::uuid`,
        withCheck: sql`pg_trigger_depth()>0 AND owner_object_id=nullif(current_setting('app.document_object_id',true),'')::uuid`,
      }),
    ],
  },
);
export const documents = documentsDefinition.table;
export const documentsHistory = documentsDefinition.history;

/** OBJ-4: метаданные и конверт ключа находятся только в базе, блоки — на томе. */
const fileColumns = () => ({
  parentId: uuid('parent_id').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageKey: uuid('storage_key').notNull(),
  envelope: jsonb('envelope').notNull(),
  previewStorageKey: uuid('preview_storage_key'),
  previewEnvelope: jsonb('preview_envelope'),
});
const noteFilesDefinition = recordTable('note_files', 'note_file', fileColumns(), {
  parent: notes,
});
export const noteFiles = noteFilesDefinition.table;
export const noteFilesHistory = noteFilesDefinition.history;
const objectFilesDefinition = recordTable('object_files', 'object_file', fileColumns(), {
  parent: objects,
});
export const objectFiles = objectFilesDefinition.table;
export const objectFilesHistory = objectFilesDefinition.history;
const documentFilesDefinition = recordTable('document_files', 'document_file', fileColumns(), {
  parent: documents,
  visibleSql: 'EXISTS (SELECT 1 FROM documents d WHERE d.id=parent_id)',
  updateVisibilitySql: 'EXISTS (SELECT 1 FROM documents d WHERE d.id=parent_id)',
});
export const documentFiles = documentFilesDefinition.table;
export const documentFilesHistory = documentFilesDefinition.history;

/** Фото принадлежит профилю; семейная аудитория вычисляется по действующим членствам. */
export const profileFiles = pgTable(
  'profile_files',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    title: text('title').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: uuid('storage_key').notNull(),
    envelope: jsonb('envelope').notNull(),
    previewStorageKey: uuid('preview_storage_key'),
    previewEnvelope: jsonb('preview_envelope'),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('profile_files_account_idx').on(t.accountId),
    pgPolicy('profile_files_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(
        `account_id = app.current_account_id() OR (deleted_at IS NULL AND EXISTS (SELECT 1 FROM member_profiles p WHERE p.account_id = profile_files.account_id AND p.photo_file_id = profile_files.id))`,
      ),
    }),
    pgPolicy('profile_files_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql.raw(`account_id = app.current_account_id() AND deleted_at IS NULL`),
    }),
    pgPolicy('profile_files_update', {
      for: 'update',
      to: appRole,
      using: sql.raw(`account_id = app.current_account_id()`),
      withCheck: sql.raw(`account_id = app.current_account_id()`),
    }),
    pgPolicy('profile_files_purge_select', {
      for: 'select',
      to: workerRole,
      using: sql.raw(`deleted_at < now() - interval '30 days'`),
    }),
    pgPolicy('profile_files_purge', {
      for: 'delete',
      to: workerRole,
      using: sql.raw(`deleted_at < now() - interval '30 days'`),
    }),
  ],
);

/** Реестр действующих блоков: обработчик видит только случайные ключи, без имён и конвертов. */
export const fileBlobs = pgTable(
  'file_blobs',
  {
    key: uuid('key').primaryKey(),
  },
  () => [
    pgPolicy('file_blobs_worker_select', { for: 'select', to: workerRole, using: sql`true` }),
    pgPolicy('file_blobs_app_select', {
      for: 'select',
      to: appRole,
      using: sql`pg_trigger_depth() > 0`,
    }),
    pgPolicy('file_blobs_app_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`pg_trigger_depth() > 0`,
    }),
    pgPolicy('file_blobs_app_delete', {
      for: 'delete',
      to: appRole,
      using: sql`pg_trigger_depth() > 0`,
    }),
    pgPolicy('file_blobs_worker_delete', {
      for: 'delete',
      to: workerRole,
      using: sql`pg_trigger_depth() > 0`,
    }),
  ],
);

/** CONT-2: общий контракт оставляет место для человека в R1b.3. */
const contactsDefinition = recordTable(
  'contacts',
  'contact',
  {
    kind: text('kind').notNull().default('organization'),
    organizationId: uuid('organization_id'),
    data: jsonb('data').$type<OrganizationData | PersonData>().notNull().default({
      organizationType: 'other',
      phones: [],
      website: null,
      address: '',
      openingHours: '',
      note: '',
    }),
  },
  { extraChecks: [check('contacts_kind_check', sql`kind IN ('organization','person')`)] },
);
export const contacts = contactsDefinition.table;
export const contactsHistory = contactsDefinition.history;

/** CONT-4: запись наследует место контакта; объект — отдельный видимый конец связи. */
const contactInteractionsDefinition = recordTable(
  'contact_interactions',
  'contact_interaction',
  {
    parentId: uuid('parent_id').notNull(),
    kind: text('kind').notNull().default('call'),
    occurredOn: date('occurred_on').notNull().default(sql`CURRENT_DATE`),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    callAgain: boolean('call_again'),
    objectId: uuid('object_id'),
  },
  {
    parent: contacts,
    visibleSql: 'EXISTS (SELECT 1 FROM contacts c WHERE c.id=parent_id)',
    updateVisibilitySql: 'EXISTS (SELECT 1 FROM contacts c WHERE c.id=parent_id)',
    extraChecks: [
      check('contact_interactions_kind', sql`kind IN ('call','visit','message','work')`),
      check('contact_interactions_amount', sql`amount_cents BETWEEN 0 AND 9007199254740991`),
    ],
  },
);
export const contactInteractions = contactInteractionsDefinition.table;
export const contactInteractionsHistory = contactInteractionsDefinition.history;
/** UTIL-2, OBJ-5: доступ и жизненный цикл определяет объект. */
const utilityAccountsDefinition = recordTable(
  'utility_accounts',
  'utility_account',
  {
    parentId: uuid('parent_id').notNull(),
    supplierId: uuid('supplier_id').references(() => contacts.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<UtilityAccountData>().notNull().default({
      services: [],
      number: '',
      transmission: null,
      readingRule: null,
      paymentRule: null,
      payer: 'owner',
      cabinetUrl: null,
      note: '',
    }),
  },
  {
    parent: objects,
    extraPolicies: [
      pgPolicy('utility_accounts_charges_worker', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id=utility_accounts.parent_id)`,
      }),
    ],
  },
);
export const utilityAccounts = utilityAccountsDefinition.table;
export const utilityAccountsHistory = utilityAccountsDefinition.history;

const metersDefinition = recordTable(
  'meters',
  'meter',
  {
    parentId: uuid('parent_id').notNull(),
    utilityAccountId: uuid('utility_account_id').references(() => utilityAccounts.id, {
      onDelete: 'set null',
    }),
    previousMeterId: uuid('previous_meter_id').references((): AnyPgColumn => meters.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').generatedAlwaysAs(sql`data->>'status'='active'`),
    data: jsonb('data')
      .$type<MeterData>()
      .notNull()
      .default(MeterData.parse({ resource: 'cold_water' })),
    searchText: text('search_text').generatedAlwaysAs(
      sql`title || ' ' || coalesce(data->>'serialNumber','')`,
    ),
  },
  {
    parent: objects,
    extraPolicies: [
      pgPolicy('meters_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id=meters.parent_id AND d.source_kind<>'record')`,
      }),
    ],
  },
);
export const meters = metersDefinition.table;
export const metersHistory = metersDefinition.history;
const meterReadingsDefinition = recordTable(
  'meter_readings',
  'meter_reading',
  {
    parentId: uuid('parent_id').notNull(),
    occurredOn: date('occurred_on').notNull(),
    values: numeric('values').array().notNull().default(sql`ARRAY[0.000]::numeric[]`),
    consumption: numeric('consumption').array(),
    rollover: boolean('rollover').notNull().default(false),
    comment: text('comment').notNull().default(''),
    transmittedAt: timestamp('transmitted_at', { withTimezone: true }),
    transmissionMethod: text('transmission_method'),
  },
  {
    parent: meters,
    extraPolicies: [
      pgPolicy('meter_readings_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM meters m WHERE m.id=meter_readings.parent_id)`,
      }),
    ],
  },
);
export const meterReadings = meterReadingsDefinition.table;
export const meterReadingsHistory = meterReadingsDefinition.history;

/** UTIL-9/10: денежные записи отменяются; корзина только каскадом родителя. */
const chargesDefinition = recordTable(
  'utility_charges',
  'utility_charge',
  {
    parentId: uuid('parent_id').notNull(),
    period: text('period').notNull(),
    totalCents: bigint('total_cents', { mode: 'number' }).notNull(),
    lines: jsonb('lines').$type<ChargeLine[]>().notNull().default([]),
    dueOn: date('due_on').notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
    isPaid: boolean('is_paid').notNull().default(false),
  },
  {
    parent: utilityAccounts,
    extraChecks: [
      check('charges_cents', sql`total_cents BETWEEN 0 AND 1000000000000`),
      check('charges_period', sql`period ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    ],
    extraPolicies: [
      pgPolicy('utility_charges_deadline_worker_select', {
        for: 'select',
        to: workerRole,
        using: sql`EXISTS (SELECT 1 FROM deadlines d WHERE d.object_id IN (SELECT a.parent_id FROM utility_accounts a WHERE a.id=utility_charges.parent_id))`,
      }),
    ],
  },
);
export const utilityCharges = chargesDefinition.table;
export const utilityChargesHistory = chargesDefinition.history;
const paymentsDefinition = recordTable(
  'utility_payments',
  'utility_payment',
  {
    parentId: uuid('parent_id').notNull(),
    paidOn: date('paid_on').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    payer: jsonb('payer').$type<PaymentInput['payer']>().notNull(),
    method: text('method').$type<PaymentInput['method']>().notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),
  },
  {
    parent: utilityCharges,
    extraChecks: [check('payments_cents', sql`amount_cents BETWEEN 1 AND 1000000000000`)],
  },
);
export const utilityPayments = paymentsDefinition.table;
export const utilityPaymentsHistory = paymentsDefinition.history;

/** Техническая квитанция идемпотентности без текстов запроса. */
export const templateApplications = pgTable(
  'template_applications',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    key: uuid('key').notNull(),
    requestHash: text('request_hash').notNull(),
    objectId: uuid('object_id').references(() => objects.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('template_applications_key').on(t.accountId, t.key),
    pgPolicy('template_applications_select', {
      for: 'select',
      to: appRole,
      using: sql`account_id=app.current_account_id()`,
    }),
    pgPolicy('template_applications_insert', {
      for: 'insert',
      to: appRole,
      withCheck: sql`account_id=app.current_account_id()`,
    }),
  ],
);

/** Таблица-пример для каждого вида записи. */
export const RECORD_TABLES = {
  note: notes,
  note_item: noteItems,
  shopping_item: shoppingItems,
  task: tasks,
  object: objects,
  object_field: objectFields,
  object_event: objectEvents,
  note_file: noteFiles,
  object_file: objectFiles,
  contact: contacts,
  contact_interaction: contactInteractions,
  utility_account: utilityAccounts,
  meter: meters,
  meter_reading: meterReadings,
  utility_charge: utilityCharges,
  utility_payment: utilityPayments,
  document: documents,
  document_file: documentFiles,
} as const satisfies Record<RecordType, unknown>;

/** История изменений каждого вида записи (OBJ-6). */
export const RECORD_HISTORY_TABLES = {
  note: notesHistory,
  note_item: noteItemsHistory,
  shopping_item: shoppingItemsHistory,
  task: tasksHistory,
  object: objectsHistory,
  object_field: objectFieldsHistory,
  object_event: objectEventsHistory,
  note_file: noteFilesHistory,
  object_file: objectFilesHistory,
  contact: contactsHistory,
  contact_interaction: contactInteractionsHistory,
  utility_account: utilityAccountsHistory,
  meter: metersHistory,
  meter_reading: meterReadingsHistory,
  utility_charge: utilityChargesHistory,
  utility_payment: utilityPaymentsHistory,
  document: documentsHistory,
  document_file: documentFilesHistory,
} as const satisfies Record<RecordType, unknown>;
// ---------------------------------------------------------------------------------------------
// Таблицы входа (ADR-0005). Первые шесть — модели Better Auth: имена моделей и полей заданы в
// настройках библиотеки (apps/server/src/auth), форма таблиц проверяется там же
// (schema.test.ts). Остальные — своё: приглашения, журнал входов, блокировки, сброс пароля.
// Приложению (homecrm_app) пароли, секреты и сессии не выданы вовсе: права на эти таблицы
// есть только у службы входа (homecrm_auth).
// ---------------------------------------------------------------------------------------------

/**
 * Сроки хранения служебных записей входа. Просроченное убирает обработчик под ролью
 * homecrm_worker (apps/server/src/auth/cleanup.ts); политики ниже дают ему видеть и удалять
 * только такие строки.
 */
export const RETENTION = {
  /** Приглашение после принятия, отзыва или истечения срока. */
  invitations: '30 days',
  /** Журнал входов (AUTH-8): участник видит свои входы за это время. */
  loginEvents: '180 days',
  /** Отметка о сбросе пароля после того, как ребёнок её прочитал, или после истёкшей ссылки. */
  passwordResets: '30 days',
} as const;

/** Блокировка закончилась и окно счётчика давно прошло: строка больше ничего не значит. */
const LOCK_CLEANUP_SQL = `(locked_until IS NULL OR locked_until < now()) AND window_started_at < now() - interval '1 hour'`;

/**
 * Таблица → условие «эту строку уже можно убрать». Заполняется при объявлении таблиц ниже;
 * обработчик (cleanup.ts) удаляет по тому же условию, что и политика: два замка вместо одного.
 */
export const CLEANUP_CONDITIONS: Record<string, string> = {};

/** Политики обработчика: видеть и удалять только строки, которые по условию уже можно убрать. */
function cleanupPolicies(table: string, condition: string) {
  CLEANUP_CONDITIONS[table] = condition;
  return [
    pgPolicy(`${table}_worker_cleanup_select`, {
      for: 'select',
      to: workerRole,
      using: sql.raw(condition),
    }),
    pgPolicy(`${table}_worker_cleanup`, {
      for: 'delete',
      to: workerRole,
      using: sql.raw(condition),
    }),
  ];
}

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
    unique('sessions_id_user_key').on(t.id, t.userId),
    index('sessions_user_id_idx').on(t.userId),
    ...authPolicies('sessions', ['select', 'insert', 'update', 'delete']),
    ...cleanupPolicies('sessions', 'expires_at < now()'),
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
    ...cleanupPolicies('verifications', 'expires_at < now()'),
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
    // Счётчик, не тронутый больше суток, давно вне любого окна ограничения.
    ...cleanupPolicies(
      'rate_limits',
      `last_request < (extract(epoch from now()) * 1000)::bigint - 86400000`,
    ),
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
    ...cleanupPolicies(
      'invitations',
      `COALESCE(accepted_at, revoked_at, expires_at) < now() - interval '${RETENTION.invitations}'`,
    ),
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
    ...cleanupPolicies('login_events', `created_at < now() - interval '${RETENTION.loginEvents}'`),
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
  () => [
    ...authPolicies('login_locks', ['select', 'insert', 'update', 'delete']),
    ...cleanupPolicies('login_locks', LOCK_CLEANUP_SQL),
  ],
);

/**
 * Попытки входа под именем, которого нет (AUTH-8). Блокировка не должна выдавать, какие имена
 * существуют: на несуществующее имя она наступает так же, как на существующее. Ключ — хэш
 * нормализованного имени, само имя не хранится.
 */
export const loginNameAttempts = pgTable(
  'login_name_attempts',
  {
    nameHash: text('name_hash').primaryKey(),
    failures: integer('failures').notNull().default(0),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  () => [
    ...authPolicies('login_name_attempts', ['select', 'insert', 'update', 'delete']),
    ...cleanupPolicies('login_name_attempts', LOCK_CLEANUP_SQL),
  ],
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
    // Подтвердить прочтение может только сам ребёнок спустя 7 дней после выполненного сброса;
    // право UPDATE — только на acknowledged_at (AUTH-5, решение владельца).
    pgPolicy('password_resets_ack', {
      for: 'update',
      to: appRole,
      using: sql.raw(`${ownAccountSql()} AND completed_at <= now() - interval '7 days'`),
      withCheck: sql.raw(`${ownAccountSql()} AND completed_at <= now() - interval '7 days'`),
    }),
    ...cleanupPolicies(
      'password_resets',
      `(acknowledged_at < now() - interval '${RETENTION.passwordResets}') OR (completed_at IS NULL AND expires_at < now() - interval '${RETENTION.passwordResets}')`,
    ),
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
