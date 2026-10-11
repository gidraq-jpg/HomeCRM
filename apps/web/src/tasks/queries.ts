import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { listScopeOf } from '../notes/queries.ts';
import {
  fetchPlan,
  fetchTask,
  fetchTaskHistory,
  fetchTasks,
  fetchToday,
  PAGE_SIZE,
  type TaskFilters,
} from './api.ts';
export function useTask(id: string | undefined) {
  const { me } = useHousehold();
  return useQuery({
    queryKey: ['tasks', me.id, 'card', id],
    enabled: !!id,
    queryFn: ({ signal }) => fetchTask(id ?? '', signal),
  });
}
export function useTaskHistory(id: string) {
  const { me } = useHousehold();
  return useQuery({
    queryKey: ['tasks', me.id, 'history', id],
    queryFn: ({ signal }) => fetchTaskHistory(id, signal),
  });
}
export function useTaskList(
  filters: TaskFilters = {},
  trash = false,
  selectedHouse?: string | null,
) {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  return useInfiniteQuery({
    queryKey: ['tasks', me.id, selectedHouse ?? householdId, 'all', scope, filters, trash],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      fetchTasks(listScopeOf(scope), filters, pageParam, trash, signal),
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
  });
}
export function useToday(householdId: string | null) {
  const { me } = useHousehold();
  const { scope } = useScope();
  return useQuery({
    queryKey: ['tasks', me.id, householdId, 'today', scope],
    queryFn: ({ signal }) => fetchToday(listScopeOf(scope), householdId, signal),
  });
}
export function usePlan(householdId: string | null) {
  const { me } = useHousehold();
  const { scope } = useScope();
  return useInfiniteQuery({
    queryKey: ['tasks', me.id, householdId, 'plan', scope],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      fetchPlan(listScopeOf(scope), householdId, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function useRefreshTasks() {
  const client = useQueryClient();
  return () =>
    Promise.all(
      [
        'tasks',
        'deadlines',
        'objects',
        'documents',
        'files',
        'search',
        'notifications',
        'links',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    );
}
export function uniqueTasks<T extends { id: string }>(tasks: T[]): T[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()];
}
