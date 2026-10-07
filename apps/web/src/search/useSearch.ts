import { useEffect, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { fetchSearch, type SearchResult } from './api.ts';
/** Запрос и результаты живут только в состоянии страницы, без URL, storage и кэша QueryClient. */
export function useSearch(query: string) {
  const { scope } = useScope();
  const q = query.trim();
  const key = JSON.stringify([q, scope]);
  const [result, setResult] = useState<{
    key: string;
    data?: SearchResult;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    if (q.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchSearch(q, scope === 'shared' ? 'household' : scope, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setResult({ key, data });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ key, error: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, scope, key]);
  return result?.key === key ? result : null;
}
