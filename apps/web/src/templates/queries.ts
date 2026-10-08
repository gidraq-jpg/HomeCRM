import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { fetchOnboarding, fetchTemplates } from './api.ts';

// Ключи запросов не содержат названий: только вид запроса.

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: ({ signal }) => fetchTemplates(signal),
    staleTime: 60_000,
  });
}

/** Пустота дома — только для администратора: остальным запрос не идёт. */
export function useOnboarding() {
  const { isAdmin } = useHousehold();
  return useQuery({
    queryKey: ['onboarding'],
    queryFn: ({ signal }) => fetchOnboarding(signal),
    enabled: isAdmin,
  });
}

/** Шаблон создаёт объект и всё дерево под ним: перечитываем всё, что от них зависит. */
export function useRefreshAfterTemplate() {
  const client = useQueryClient();
  return () => client.invalidateQueries();
}
