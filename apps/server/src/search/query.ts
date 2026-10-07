import { searchKeyFilter, sql } from '@homecrm/db';
/** Сортировка начинается с названия: LIMIT не должен выбирать сканирование PK по виду,
 * когда множество совпадений целиком лежит в чужом пространстве. */
export function searchRowsQuery(
  q: string,
  scope: 'all' | 'household' | 'personal',
  keys: readonly string[],
) {
  return sql`SELECT source_type,source_id,target_id,title,content,space_id,space_kind,audience,owner_id,
    ts_headline('russian',content,plainto_tsquery('russian',${q}),
      'StartSel=‹, StopSel=›, MaxWords=24, MinWords=8, MaxFragments=1') AS snippet
    FROM search_index WHERE ${searchKeyFilter(keys)} AND ${scope === 'all' ? sql`true` : sql`space_kind=${scope}::space_kind`}
    ORDER BY title,source_type,source_id LIMIT 151`;
}
