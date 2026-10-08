import type { QueryClient } from '@tanstack/react-query';

export const ME_KEY = 'me';

/**
 * Другой участник вошёл в соседней вкладке (или сессия закончилась): кэш прежнего участника, с названиями
 * записей и списками, выбрасываем до того, как экраны получат нового `me`. Запрос `me` остаётся: его
 * наблюдает сам `AuthRoot`, и удалять его на ходу нельзя.
 */
export function dropCacheOnAccountChange(
  client: QueryClient,
  previous: { id: string } | null | undefined,
  next: { id: string } | null,
): void {
  if (!previous || previous.id === next?.id) return;
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY });
}
