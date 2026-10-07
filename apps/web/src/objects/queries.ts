import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { ApiError } from '../auth/api.ts';
import { listScopeOf } from '../notes/queries.ts';
import {
  fetchLinks,
  fetchObject,
  fetchObjects,
  fetchTimeline,
  type ObjectSummary,
  PAGE_SIZE,
  previewObjectAccess,
  type RecordRef,
} from './api.ts';

// Ключи запросов не содержат названий и текстов: только идентификаторы и режим списка.
const OBJECTS = 'objects';
const LINKS = 'links';

/** Список объектов под выбранный в шапке режим; постранично, чтобы не грузить всё сразу. */
export function useObjectsList(trash: boolean) {
  const { scope } = useScope();
  const listScope = listScopeOf(scope);
  return useInfiniteQuery({
    queryKey: [OBJECTS, 'list', listScope, trash],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchObjects(listScope, { trash, offset: pageParam }, signal),
    getNextPageParam: (last: ObjectSummary[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

export function useObjectCard(id: string | undefined) {
  return useQuery({
    queryKey: [OBJECTS, 'card', id],
    queryFn: ({ signal }) => fetchObject(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/** Лента объекта: страницы по курсору, который сервер отдаёт непрозрачным. */
export function useTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: [OBJECTS, 'timeline', id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchTimeline(id, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** Связи записи: только те, у которых видны оба конца (OBJ-2). */
export function useLinks(ref: RecordRef) {
  return useQuery({
    queryKey: [LINKS, ref.type, ref.id],
    queryFn: ({ signal }) => fetchLinks(ref, signal),
  });
}

/**
 * Можно ли автору общего объекта сделать его личным. Есть ли в нём чужой вклад (PRD 7.3.6), API
 * не отдаёт, зато предпросмотр отвечает отказом 403: так интерфейс узнаёт, что доступно только
 * «Скопировать в личное». Заодно предпросмотр приносит список тех, кто потеряет доступ.
 */
export function useObjectMakePersonalProbe(id: string, version: string, enabled: boolean) {
  const query = useQuery({
    queryKey: [OBJECTS, 'probe', id, version],
    queryFn: () => previewObjectAccess(id, { action: 'personal' }),
    enabled,
  });
  return {
    pending: enabled && query.isPending,
    /** Сервер отказал: в объекте есть правки других участников. */
    blocked: query.error instanceof ApiError && query.error.status === 403,
    preview: query.data,
    error: query.isError && !(query.error instanceof ApiError && query.error.status === 403),
    refetch: query.refetch,
  };
}

/** Что перечитать после изменения объекта: списки, карточки, ленту, корзину и связи. */
export function useRefreshObjects() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [OBJECTS] }),
      client.invalidateQueries({ queryKey: [LINKS] }),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]);
}
