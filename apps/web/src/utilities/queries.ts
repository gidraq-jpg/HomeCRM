import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { fetchAnalytics, fetchMonth } from './api.ts';

// Ключи запросов содержат только месяц и идентификатор объекта.
const UTILITIES = 'utilities';

export function useMonth(month?: string, house?: string | null) {
  const { scope } = useScope();
  const { me, householdId } = useHousehold();
  const home = house === undefined ? householdId : house;
  return useQuery({
    queryKey: [UTILITIES, me.id, 'month', month, scope, home],
    queryFn: ({ signal }) =>
      fetchMonth(month, signal, {
        scope: scope === 'shared' ? 'household' : scope,
        ...(home ? { householdId: home } : {}),
      }),
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
