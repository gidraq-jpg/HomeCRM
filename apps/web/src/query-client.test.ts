import type { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './auth/api.ts';
import { dropCacheOnAccountChange, ME_KEY } from './auth/session-cache.ts';
import { prefetchSections } from './prefetch.ts';
import { CACHE_GC_MS, CACHE_STALE_MS, createQueryClient } from './query-client.ts';

function filled(client: QueryClient) {
  client.setQueryData([ME_KEY], { id: 'fictional-anna' });
  client.setQueryData(['objects', 'list', 'all', false], {
    pages: [[{ title: 'Квартира у парка' }]],
  });
  client.setQueryData(['tasks', 'fictional-anna', null, 'today', 'all'], { tasks: [] });
}

describe('кэш данных клиента (D48)', () => {
  it('данные раздела живут 10 минут, свежие — 30 секунд, и только в памяти', () => {
    const options = createQueryClient().getDefaultOptions().queries;
    expect(options?.gcTime).toBe(CACHE_GC_MS);
    expect(CACHE_GC_MS).toBe(10 * 60_000);
    expect(options?.staleTime).toBe(CACHE_STALE_MS);
    expect(CACHE_STALE_MS).toBe(30_000);
  });

  it('после выхода и входа другим участником в кэше нет данных первого', () => {
    const client = createQueryClient();
    filled(client);
    // Выход: AuthRoot очищает кэш целиком, затем входит другой участник.
    client.clear();
    client.setQueryData([ME_KEY], { id: 'fictional-boris' });
    expect(client.getQueryData(['objects', 'list', 'all', false])).toBeUndefined();
    expect(client.getQueryData(['tasks', 'fictional-anna', null, 'today', 'all'])).toBeUndefined();
  });

  it('вход другого участника без выхода (соседняя вкладка) тоже выбрасывает чужие списки', () => {
    const client = createQueryClient();
    filled(client);
    dropCacheOnAccountChange(client, { id: 'fictional-anna' }, { id: 'fictional-boris' });
    expect(client.getQueryData(['objects', 'list', 'all', false])).toBeUndefined();
  });

  it('ответ 401 выбрасывает данные участника и перечитывает «кто я»', async () => {
    const client = createQueryClient();
    filled(client);
    await client
      .fetchQuery({
        queryKey: ['documents', 'list'],
        queryFn: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED')),
      })
      .catch(() => undefined);
    expect(client.getQueryData(['objects', 'list', 'all', false])).toBeUndefined();
    expect(client.getQueryState([ME_KEY])?.isInvalidated).toBe(true);
  });

  it('ответ 500 кэш не трогает', async () => {
    const client = createQueryClient();
    filled(client);
    await client
      .fetchQuery({
        queryKey: ['documents', 'list'],
        queryFn: () => Promise.reject(new ApiError(500, 'INTERNAL')),
      })
      .catch(() => undefined);
    expect(client.getQueryData(['objects', 'list', 'all', false])).toBeDefined();
  });
});

describe('подгрузка разделов после входа', () => {
  it('списки кладутся под ключи своего пространства, чужого пространства в кэше нет', async () => {
    const fetched = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    try {
      const client = createQueryClient();
      await prefetchSections(client, {
        meId: 'fictional-anna',
        householdId: null,
        scope: 'personal',
      });
      expect(client.getQueryData(['objects', 'list', 'personal', false])).toBeDefined();
      expect(client.getQueryData(['objects', 'list', 'all', false])).toBeUndefined();
      expect(client.getQueryData(['objects', 'list', 'household', false])).toBeUndefined();
      const keys = client
        .getQueryCache()
        .getAll()
        .map((query) => JSON.stringify(query.queryKey));
      expect(keys.some((key) => key.includes('"documents"') && key.includes('"personal"'))).toBe(
        true,
      );
      expect(keys.some((key) => key.includes('"contacts"') && key.includes('"personal"'))).toBe(
        true,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
