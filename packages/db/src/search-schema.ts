// SRCH-1…4: производный индекс. Исходные записи остаются единственным источником данных.
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  pgPolicy,
  pgRole,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { canViewSql } from './access-sql.ts';
import { appRole, audienceEnum, spaceKindEnum } from './core.ts';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const ownerRole = pgRole('homecrm_owner').existing();

// Предикат находится внутри RLS: PostgreSQL не продвигает @@/LIKE через барьер RLS
// (они не LEAKPROOF). Контекст ограничен транзакцией, как account_id; см. ADR-0027.
export const SEARCH_MATCH_SQL = `(
  document @@ plainto_tsquery('russian', nullif(current_setting('app.search_query',true),''))
  OR content ILIKE current_setting('app.search_pattern',true) ESCAPE E'\\\\'
  OR digits LIKE current_setting('app.search_digit_pattern',true)
)`;
export const SEARCH_VIEW_SQL = `${canViewSql()} AND (
  source_type <> 'object_event' OR (
    app.placement_visible(origin_space_id,origin_space_kind,origin_audience)
    AND app.search_parent_visible(target_id)
  )
) AND (source_type <> 'document' OR EXISTS(SELECT 1 FROM documents d WHERE d.id=source_id))`;

export const searchIndex = pgTable(
  'search_index',
  {
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    accessKey: text('access_key').notNull(),
    targetId: uuid('target_id').notNull(),
    spaceId: uuid('space_id').notNull(),
    spaceKind: spaceKindEnum('space_kind').notNull(),
    audience: audienceEnum('audience'),
    ownerId: uuid('owner_id'),
    authorId: uuid('author_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    originSpaceId: uuid('origin_space_id'),
    originSpaceKind: spaceKindEnum('origin_space_kind'),
    originAudience: audienceEnum('origin_audience'),
    document: tsvector('document').generatedAlwaysAs(
      sql`to_tsvector('russian'::regconfig, content)`,
    ),
    digits: text('digits').generatedAlwaysAs(sql`regexp_replace(content, '[^0-9]', '', 'g')`),
  },
  (t) => [
    primaryKey({ columns: [t.sourceType, t.sourceId] }),
    index('search_index_space_idx').on(t.spaceId, t.audience),
    index('search_index_document_idx')
      .using('gin', t.accessKey.op('text_ops'), t.document)
      .with({ fastupdate: false }),
    index('search_index_content_idx')
      .using('gin', t.accessKey.op('text_ops'), t.content.op('gin_trgm_ops'))
      .with({ fastupdate: false }),
    index('search_index_digits_idx')
      .using('gin', t.accessKey.op('text_ops'), t.digits.op('gin_trgm_ops'))
      .with({ fastupdate: false }),
    pgPolicy('search_index_select', {
      for: 'select',
      to: appRole,
      using: sql.raw(`(${SEARCH_VIEW_SQL}) AND (${SEARCH_MATCH_SQL})`),
    }),
    pgPolicy('search_index_sync', {
      for: 'all',
      to: ownerRole,
      using: sql`pg_trigger_depth() > 0`,
      withCheck: sql`pg_trigger_depth() > 0`,
    }),
  ],
).enableRLS();
