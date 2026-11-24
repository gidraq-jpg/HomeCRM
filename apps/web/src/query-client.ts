import { QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './auth/api.ts';
import { ME_KEY } from './auth/session-cache.ts';
import { sessionSettled, staleSession } from './auth/session-epoch.ts';

/** Данные раздела живут в памяти 10 минут после ухода с экрана (ADR-0007, D48). */
export const CACHE_GC_MS = 10 * 60_000;
/** 30 секунд данные свежие; потом при возврате показываются сразу и обновляются в фоне. */
export const CACHE_STALE_MS = 30_000;

/**
 * Клиент запросов. Кэш только в памяти: ничего не пишется в IndexedDB и localStorage.
 * Ответ 401 означает, что сессии больше нет: данные участника выбрасываются, а проверка «кто я»
 * перечитывается и возвращает на экран входа. Исключение — 401 запроса, начатого до смены сессии
 * действием входа (session-epoch.ts): он не выход, а повод перепроверить сессию.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!(error instanceof ApiError) || error.status !== 401 || query.queryKey[0] === ME_KEY)
          return;
        // Запрос ушёл со старой сессией, пока действие входа меняло её (D58): данные не
        // выбрасываем, а после действия перепроверяем «кто я» и перечитываем этот запрос.
        if (error.sessionMark !== null && staleSession(error.sessionMark)) {
          void sessionSettled().then(async () => {
            await client.invalidateQueries({ queryKey: [ME_KEY] }, { cancelRefetch: false });
            await client.invalidateQueries({ queryKey: query.queryKey, exact: true });
          });
          return;
        }
        client.removeQueries({ predicate: (item) => item.queryKey[0] !== ME_KEY });
        // Идущую проверку «кто я» не отменяем: экраны после очистки перечитывают данные, каждый
        // новый 401 отменял бы её заново, и выход на экран входа не наступал бы никогда (D58).
        void client.invalidateQueries({ queryKey: [ME_KEY] }, { cancelRefetch: false });
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
        refetchOnReconnect: 'always',
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}
