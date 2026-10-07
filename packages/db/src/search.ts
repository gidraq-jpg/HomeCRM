import { canView, type Viewer } from '@homecrm/shared';
import { sql } from 'drizzle-orm';
import type { Transaction } from './client.ts';
import { spaces } from './core.ts';

/** Явные ключи видимых мест позволяют GIN отсечь чужие совпадения внутри самого индекса. */
export async function searchAccessKeys(tx: Transaction, viewer: Viewer): Promise<string[]> {
  const available = await tx.select().from(spaces);
  return available.flatMap((space) =>
    space.kind === 'personal'
      ? space.ownerAccountId === viewer.accountId
        ? [`${space.id}:personal`]
        : []
      : (['household', 'adults'] as const)
          .filter((audience) => canView(viewer, { kind: 'household', spaceId: space.id, audience }))
          .map((audience) => `${space.id}:${audience}`),
  );
}

export function searchKeyFilter(keys: readonly string[]) {
  return sql`access_key = ANY(ARRAY[${sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )}]::text[])`;
}

/** Экранирование LIKE: %, _ и обратная косая черта ищутся как обычные символы. */
export function searchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Только SET LOCAL: запрос не переживает транзакцию и не смешивается между участниками пула. */
export async function setSearchQuery(tx: Transaction, query: string): Promise<void> {
  const digits = /^[\d\s()+.-]+$/.test(query) ? query.replace(/\D/g, '') : '';
  await tx.execute(sql`SELECT set_config('app.search_query',${query},true),
    set_config('jit','off',true),
    set_config('app.search_pattern',${searchPattern(query)},true),
    set_config('app.search_digit_pattern',${digits.length >= 3 ? `%${digits}%` : 'no-digits'},true)`);
}
