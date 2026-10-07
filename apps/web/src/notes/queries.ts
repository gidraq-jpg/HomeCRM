import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import type { Scope } from '../access/scope.ts';
import { ApiError } from '../auth/api.ts';
import {
  fetchNote,
  fetchNotes,
  type ListScope,
  type NoteSummary,
  PAGE_SIZE,
  previewAccess,
} from './api.ts';

// Ключи запросов не содержат заголовков и текстов: только идентификаторы и режим списка.
const NOTES = 'notes';

/** Переключатель «Всё · Общее · Личное» → параметр `scope` API заметок. */
export function listScopeOf(scope: Scope): ListScope {
  return scope === 'shared' ? 'household' : scope;
}

/** Список заметок под выбранный в шапке режим; постранично, чтобы не грузить всё сразу. */
export function useNotesList(trash: boolean) {
  const { scope } = useScope();
  const listScope = listScopeOf(scope);
  return useInfiniteQuery({
    queryKey: [NOTES, 'list', listScope, trash],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchNotes(listScope, { trash, offset: pageParam }, signal),
    getNextPageParam: (last: NoteSummary[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

export function useNoteCard(id: string | undefined) {
  return useQuery({
    queryKey: [NOTES, 'card', id],
    queryFn: ({ signal }) => fetchNote(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/**
 * Можно ли автору общей заметки сделать её личной. Есть ли в ней чужой вклад (PRD 7.3.6), API
 * не отдаёт, зато предпросмотр отвечает отказом 403: так интерфейс узнаёт, что доступно только
 * «Скопировать в личное». Заодно предпросмотр приносит список тех, кто потеряет доступ.
 */
export function useMakePersonalProbe(id: string, version: string, enabled: boolean) {
  const query = useQuery({
    queryKey: [NOTES, 'probe', id, version],
    queryFn: () => previewAccess(id, { action: 'personal' }),
    enabled,
  });
  return {
    pending: enabled && query.isPending,
    /** Сервер отказал: в заметке есть правки других участников. */
    blocked: query.error instanceof ApiError && query.error.status === 403,
    preview: query.data,
    error: query.isError && !(query.error instanceof ApiError && query.error.status === 403),
    refetch: query.refetch,
  };
}

/** Что перечитать после изменения заметки: списки, карточки и корзину. */
export function useRefreshNotes() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [NOTES] }),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]);
}
