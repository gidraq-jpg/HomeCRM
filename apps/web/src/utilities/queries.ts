import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAnalytics, fetchMonth } from './api.ts';

// Ключи запросов содержат только месяц и идентификатор объекта.
const UTILITIES = 'utilities';

export function useMonth(month: string) {
  return useQuery({
    queryKey: [UTILITIES, 'month', month],
    queryFn: ({ signal }) => fetchMonth(month, signal),
  });
}

export function useAnalytics(objectId: string) {
  return useQuery({
    queryKey: [UTILITIES, 'analytics', objectId],
    queryFn: ({ signal }) => fetchAnalytics(objectId, signal),
  });
}

/** Обзор и аналитика зависят от начислений, оплат и показаний: после их правки их читают заново. */
export function useRefreshUtilities() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [UTILITIES] });
}
