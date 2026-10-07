import { RECORD_DEFINITIONS, sql } from '@homecrm/db';

/** Проекция всех видов под RLS; соединение отбирает видимые концы до пагинации. */
export const referenceRows = sql.join(
  RECORD_DEFINITIONS.map(
    ({ name, type }) => sql`
    SELECT ${name}::text AS table_name,${type}::text AS type,id,title,deleted_at,
      space_id,space_kind,audience,assignee_id,
      ${name === 'objects' ? sql.raw('object_type::text') : sql.raw('NULL::text')} AS object_type
    FROM ${sql.identifier(name)}
    WHERE id IN (SELECT id FROM wanted WHERE table_name=${name})
      AND app.placement_visible(space_id,space_kind,audience)`,
  ),
  sql` UNION ALL `,
);
