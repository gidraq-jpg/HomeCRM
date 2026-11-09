import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './auth/api.ts';
import { ME_KEY } from './auth/session-cache.ts';

/** Данные раздела живут в памяти 10 минут после ухода с экрана (ADR-0007, D48). */
export const CACHE_GC_MS = 10 * 60_000;
/** 30 секунд данные свежие; потом при возврате показываются сразу и обновляются в фоне. */
export const CACHE_STALE_MS = 30_000;

/**
 * Клиент запросов. Кэш только в памяти: ничего не пишется в IndexedDB и localStorage.
 * Ответ 401 означает, что сессии больше нет: данные участника выбрасываются, а проверка «кто я»
 * перечитывается и возвращает на экран входа.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.status !== 401 || query.queryKey[0] === ME_KEY)
          return;
        client.removeQueries({ predicate: (item) => item.queryKey[0] !== ME_KEY });
        void client.invalidateQueries({ queryKey: [ME_KEY] });
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: CACHE_GC_MS,
        staleTime: CACHE_STALE_MS,
        // Возврат на экран всегда показывает кэш сразу и перечитывает данные в фоне.
        refetchOnMount: 'always',
        networkMode: 'always',
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}
