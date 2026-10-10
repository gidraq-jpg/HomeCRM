import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { sql, type Transaction } from '@homecrm/db';
import {
  canViewFile,
  ExportManifest,
  ExportRecords,
  type ExportScope,
  NotificationSettings,
} from '@homecrm/shared';
import { ZipFile } from 'yazl';
import type { z } from 'zod';
import type { Account } from '../auth/account.ts';
import { safeFilename } from '../files/media.ts';
import type { FileServices } from '../files/service.ts';
import { Failure, factsOf, readReference, typeForTable } from '../objects/support.ts';

type Data = Record<string, unknown>;
export const EXPORT_PAGE_SIZE = 100;
/** Разделяет временные выгрузки параллельных процессов, включая независимые тестовые прогоны. */
export const EXPORT_TEMP_PREFIX = `homecrm-export-${process.pid}-`;
const OMIT = sql`ARRAY['search_text','is_active','is_paid','is_identity','has_other_contributions','assignee_house_id','assignee_adult_id','assignee_adult_flag','storage_key','envelope','preview_storage_key','preview_envelope','needs_refresh']::text[]`;
const TABLES = [
  'notes',
  'note_items',
  'objects',
  'documents',
  'contacts',
  'contact_interactions',
  'utility_accounts',
  'utility_charges',
  'utility_payments',
  'meters',
  'meter_readings',
  'object_fields',
  'object_events',
  'tasks',
  'shopping_items',
  'deadlines',
] as const;
const FILE_TABLES = [
  'note_files',
  'object_files',
  'document_files',
  'task_files',
  'profile_files',
] as const;
const HISTORY_TABLES = [
  'documents',
  'notes',
  'note_items',
  'objects',
  'contacts',
  'contact_interactions',
  'utility_accounts',
  'utility_charges',
  'utility_payments',
  'meters',
  'meter_readings',
  'object_fields',
  'object_events',
  'tasks',
  'shopping_items',
  'document_files',
  'task_files',
  'note_files',
  'object_files',
] as const;

function scopeWhere(scope: ExportScope, alias = 't') {
  const a = sql.identifier(alias);
  return scope.kind === 'personal'
    ? sql`${a}.space_kind='personal'`
    : sql`${a}.space_kind='household' AND ${a}.space_id=${scope.householdId}::uuid`;
}
/** Курсор по UUID: в памяти не больше одной страницы метаданных. Все запросы — под RLS. */
async function* rows(
  tx: Transaction,
  table: string,
  where: ReturnType<typeof sql>,
  projection = sql`to_jsonb(t) - ${OMIT}`,
) {
  let after: string | undefined;
  for (;;) {
    const page = (
      await tx.execute<{
        data: Data;
      }>(sql`SELECT ${projection} AS data FROM ${sql.identifier(table)} t
      WHERE (${where}) ${after ? sql`AND t.id > ${after}::uuid` : sql``} ORDER BY t.id LIMIT ${EXPORT_PAGE_SIZE}`)
    ).rows;
    if (!page.length) return;
    for (const { data } of page) yield data;
    after = String(page.at(-1)?.data.id);
  }
}
function fileWhere(scope: ExportScope, account: Account, table: string) {
  return table === 'profile_files'
    ? sql`t.account_id=${account.id}::uuid AND ${scope.kind === 'personal'}`
    : scopeWhere(scope);
}
function archivePath(row: Data) {
  return `files/${row.id}-${safeFilename(String(row.title))}`;
}
async function checkFile(tx: Transaction, account: Account, table: string, row: Data) {
  if (table === 'profile_files') {
    if (row.account_id !== account.id) throw new Failure(403, 'ACCESS_DENIED');
    return;
  }
  const type =
    table === 'task_files'
      ? 'task'
      : table === 'note_files'
        ? 'note'
        : table === 'document_files'
          ? 'document'
          : 'object';
  const parent = await readReference(tx, account, { type, id: String(row.parent_id) });
  if (
    !canViewFile(
      account.viewer,
      factsOf(
        {
          id: String(row.id),
          spaceId: String(row.space_id),
          spaceKind: row.space_kind as 'personal' | 'household',
          audience: row.audience as 'household' | 'adults' | null,
          authorId: String(row.author_id),
          assigneeId: row.assignee_id as string | null,
          deletedAt: row.deleted_at ? new Date(String(row.deleted_at)) : null,
        },
        type === 'task' ? 'task_file' : type === 'note' ? 'note_file' : 'object_file',
      ),
      parent.facts,
    )
  )
    throw new Failure(403, 'ACCESS_DENIED');
}
async function* records(
  tx: Transaction,
  account: Account,
  scope: ExportScope,
  table: (typeof TABLES)[number],
) {
  const where =
    table === 'object_events' && scope.kind === 'household'
      ? sql`${scopeWhere(scope)} AND t.origin_space_kind='household' AND t.origin_space_id=${scope.householdId}::uuid`
      : scopeWhere(scope);
  const projection =
    table === 'meter_readings'
      ? sql`(to_jsonb(t) - ${OMIT} - 'values' - 'consumption') || jsonb_build_object('values',ARRAY(SELECT v::text FROM unnest(t.values) v),'consumption',CASE WHEN t.consumption IS NULL THEN NULL ELSE ARRAY(SELECT v::text FROM unnest(t.consumption) v) END)`
      : undefined;
  for await (const row of rows(tx, table, where, projection)) {
    if (table === 'tasks') {
      if (
        row.waiting_contact_id &&
        !(
          await tx.execute(
            sql`SELECT 1 FROM contacts t WHERE id=${row.waiting_contact_id}::uuid AND ${scope.kind === 'personal' ? sql`true` : scopeWhere(scope)}`,
          )
        ).rowCount
      )
        row.waiting_contact_id = null;
      if (
        row.waiting_account_id &&
        !(
          await tx.execute(
            sql`SELECT 1 FROM member_profiles WHERE account_id=${row.waiting_account_id}::uuid`,
          )
        ).rowCount
      )
        row.waiting_account_id = null;
    }
    if (
      (table === 'contacts' && row.organization_id) ||
      (table === 'contact_interactions' && row.object_id)
    ) {
      const target = table === 'contacts' ? 'contacts' : 'objects';
      const key = table === 'contacts' ? 'organization_id' : 'object_id';
      if (
        !(
          await tx.execute(
            sql`SELECT 1 FROM ${sql.identifier(target)} t WHERE id=${String(row[key])}::uuid AND ${scope.kind === 'personal' ? sql`true` : scopeWhere(scope)}`,
          )
        ).rowCount
      )
        row[key] = null;
    }
    if (table === 'documents') {
      if (
        row.owner_contact_id &&
        !(
          await tx.execute(
            sql`SELECT 1 FROM contacts t WHERE id=${row.owner_contact_id}::uuid AND ${scope.kind === 'personal' ? sql`true` : scopeWhere(scope)}`,
          )
        ).rowCount
      )
        row.owner_contact_id = null;
      if (
        row.previous_id &&
        !(
          await tx.execute(
            sql`SELECT 1 FROM documents t WHERE id=${row.previous_id}::uuid AND ${scope.kind === 'personal' ? sql`true` : scopeWhere(scope)}`,
          )
        ).rowCount
      )
        row.previous_id = null;
    }
    if (table === 'utility_accounts' && row.supplier_id) {
      const result = await tx.execute(
        sql`SELECT 1 FROM contacts t WHERE id=${String(row.supplier_id)}::uuid AND ${scope.kind === 'personal' ? sql`true` : scopeWhere(scope)} `,
      );
      if (!result.rows.length) row.supplier_id = null;
    }
    if (table === 'object_events') {
      let contact: { table: string; id: string } | null = null;
      if (row.contact_table && row.contact_id) {
        try {
          const reference = await readReference(tx, account, {
            type: typeForTable(String(row.contact_table)),
            id: String(row.contact_id),
          });
          if (
            scope.kind === 'personal' ||
            (reference.row.spaceKind === 'household' && reference.row.spaceId === scope.householdId)
          )
            contact = { table: String(row.contact_table), id: String(row.contact_id) };
        } catch (error) {
          if (!(error instanceof Failure && error.code === 'NOT_FOUND')) throw error;
        }
      }
      delete row.contact_table;
      delete row.contact_id;
      row.contact = contact;
    }
    yield row;
  }
}
async function* histories(tx: Transaction, scope: ExportScope) {
  for (const table of HISTORY_TABLES)
    for await (const row of rows(
      tx,
      `${table}_history`,
      sql`${scopeWhere(scope)} AND EXISTS (SELECT 1 FROM ${sql.identifier(table)} p WHERE p.id=t.record_id AND ${scopeWhere(scope, 'p')}
          ${table === 'object_events' && scope.kind === 'household' ? sql`AND p.origin_space_kind='household' AND p.origin_space_id=${scope.householdId}::uuid` : sql``})`,
      sql`(to_jsonb(t) - 'changes') || jsonb_build_object('table', ${table}::text, 'changes', t.changes - ${OMIT} - ARRAY['contact_id','contact_table','supplier_id','organization_id','object_id']::text[])`,
    ))
      yield row;
}
async function* links(tx: Transaction, account: Account, scope: ExportScope) {
  const where =
    scope.kind === 'personal'
      ? sql`app.record_ref_facts(t.left_table,t.left_id)->>'spaceKind'='personal'
        OR app.record_ref_facts(t.right_table,t.right_id)->>'spaceKind'='personal'`
      : sql`true`;
  for await (const row of rows(tx, 'record_links', where)) {
    try {
      const left = await readReference(tx, account, {
        type: typeForTable(String(row.left_table)),
        id: String(row.left_id),
      });
      const right = await readReference(tx, account, {
        type: typeForTable(String(row.right_table)),
        id: String(row.right_id),
      });
      const included = (ref: typeof left) =>
        scope.kind === 'personal'
          ? ref.row.spaceKind === 'personal'
          : ref.row.spaceKind === 'household' && ref.row.spaceId === scope.householdId;
      // Личная связь может ссылаться на видимое общее; в архиве дома личных концов нет.
      if (
        scope.kind === 'personal'
          ? included(left) || included(right)
          : included(left) && included(right)
      )
        yield row;
    } catch (error) {
      if (!(error instanceof Failure && error.code === 'NOT_FOUND')) throw error;
    }
  }
}

/** ZIP на временном диске контейнера. Память: страница JSON + один файл (лимит загрузки 25 МиБ). */
export async function buildArchive(
  tx: Transaction,
  account: Account,
  scope: ExportScope,
  services: FileServices | undefined,
  homeTimeZone: string,
  parentSignal: AbortSignal,
) {
  const directory = await mkdtemp(join(tmpdir(), EXPORT_TEMP_PREFIX));
  const path = join(directory, 'export.zip');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  const { signal } = controller;
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  zip.on('error', () => {
    controller.abort();
    output.destroy(new Error('Archive failed'));
  });
  const written = pipeline(
    zip.outputStream,
    createWriteStream(path, { mode: 0o600, flags: 'wx' }),
    { signal },
  );
  void written.catch(() => controller.abort());
  const counts: Record<string, number> = {};
  async function addJSON(
    name: string,
    schema: z.ZodType,
    input: AsyncIterable<unknown> | Iterable<unknown>,
  ) {
    counts[name] = 0;
    async function* json() {
      yield '[';
      for await (const value of input) {
        signal.throwIfAborted();
        const parsed = schema.parse(value);
        yield `${counts[name] ? ',' : ''}${JSON.stringify(parsed)}`;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      yield ']';
    }
    const stream = Readable.from(json(), { signal });
    zip.addReadStream(stream, `${name}.json`);
    await finished(stream);
  }
  try {
    signal.throwIfAborted();
    // Очистка блоков не удалит файл, пока его метаданные входят в снимок выгрузки.
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended('file-block-cleanup',0))`,
    );
    const house = (
      await tx.execute<{
        time_zone: string | null;
      }>(sql`SELECT time_zone FROM spaces WHERE kind='household'
      ${scope.kind === 'household' ? sql`AND id=${scope.householdId}::uuid` : sql``} ORDER BY created_at,id LIMIT 1`)
    ).rows[0];
    for (const table of TABLES)
      await addJSON(table, ExportRecords[table], records(tx, account, scope, table));
    await addJSON('record_links', ExportRecords.record_links, links(tx, account, scope));
    await addJSON('history', ExportRecords.history, histories(tx, scope));
    await addJSON(
      'export_events',
      ExportRecords.export_events,
      rows(
        tx,
        'export_events',
        scope.kind === 'personal'
          ? sql`t.kind='personal' AND t.account_id=${account.id}::uuid`
          : sql`t.kind='household' AND t.household_id=${scope.householdId}::uuid`,
      ),
    );
    await addJSON(
      'deadline_completions',
      ExportRecords.deadline_completions,
      rows(
        tx,
        'deadline_occurrences',
        sql`t.completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM deadlines d WHERE d.id=t.deadline_id AND ${scopeWhere(scope, 'd')})`,
        sql`jsonb_build_object('id',t.id,'deadline_id',t.deadline_id,'date',t.date,'completed_at',t.completed_at)`,
      ),
    );
    for (const table of FILE_TABLES) {
      async function* metadata() {
        for await (const row of rows(tx, table, fileWhere(scope, account, table))) {
          await checkFile(tx, account, table, row);
          yield { ...row, archive_path: archivePath(row) };
        }
      }
      await addJSON(table, ExportRecords[table], metadata());
      for await (const row of rows(tx, table, fileWhere(scope, account, table), sql`to_jsonb(t)`)) {
        signal.throwIfAborted();
        await checkFile(tx, account, table, row);
        if (!services) throw new Error('File service unavailable');
        const data = services.cipher.open(
          await services.storage.get(String(row.storage_key)),
          row.envelope,
          String(row.storage_key),
        );
        if (data.length !== row.size_bytes) throw new Error('Export file size mismatch');
        const stream = Readable.from([data], { signal });
        zip.addReadStream(stream, archivePath(row), { size: data.length, compress: false });
        await finished(stream);
      }
    }
    if (scope.kind === 'personal') {
      const profiles = (
        await tx.execute<{
          data: Data;
        }>(sql`SELECT jsonb_build_object('account_id',a.id,'display_name',p.display_name,'username',a.username,
        'email',CASE WHEN a.email LIKE '%.invalid' THEN NULL ELSE a.email END,'birth_date',p.birth_date,'birthday_enabled',p.birthday_enabled,'phone',p.phone,'photo_file_id',p.photo_file_id) AS data
        FROM accounts a JOIN member_profiles p ON p.account_id=a.id WHERE a.id=${account.id}::uuid`)
      ).rows;
      await addJSON(
        'profile',
        ExportRecords.profile,
        profiles.map(({ data }) => data),
      );
      const settings = (
        await tx.execute<{
          data: Data;
        }>(sql`SELECT jsonb_build_object('quietStart',quiet_start,'quietEnd',quiet_end,
        'dailyBudget',daily_budget,'enabledKinds',enabled_kinds,'hideText',hide_text) AS data FROM notification_settings WHERE account_id=${account.id}::uuid`)
      ).rows;
      await addJSON('notification_settings', ExportRecords.notification_settings, [
        settings[0]?.data ?? NotificationSettings.parse({}),
      ]);
    } else {
      const households = (
        await tx.execute<{ data: Data }>(
          sql`SELECT jsonb_build_object('id',id,'name',name,'time_zone',coalesce(time_zone,${homeTimeZone}), 'created_at',created_at) AS data FROM spaces WHERE id=${scope.householdId}::uuid`,
        )
      ).rows;
      await addJSON(
        'household',
        ExportRecords.household,
        households.map(({ data }) => data),
      );
      // Только семейное имя и членство; чужой профиль и почта не читаются.
      const members = (
        await tx.execute<{ data: Data }>(
          sql`SELECT jsonb_build_object('account_id',account_id,'display_name',display_name,'role',role,'created_at',created_at,'left_at',left_at,'left_by',left_by) AS data FROM space_members WHERE space_id=${scope.householdId}::uuid ORDER BY account_id`,
        )
      ).rows;
      await addJSON(
        'members',
        ExportRecords.members,
        members.map(({ data }) => data),
      );
    }
    const manifest = ExportManifest.parse({
      format: 'homecrm',
      version: 1,
      exportedAt: new Date().toISOString(),
      timeZone: house?.time_zone ?? homeTimeZone,
      scope,
      includesTrash: true,
      counts,
    });
    zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json');
    zip.end();
    await written;
    return { path, cleanup, size: (await stat(path)).size, manifest };
  } catch (error) {
    output.destroy(new Error('Archive failed'));
    await written.catch(() => {});
    await cleanup();
    throw error;
  } finally {
    parentSignal.removeEventListener('abort', abort);
  }
}
