import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { listScopeOf } from '../notes/queries.ts';
import {
  type DocumentCard,
  type DocumentFilters,
  fetchDocument,
  fetchDocuments,
  fetchObjectDocuments,
  fetchVersions,
  PAGE_SIZE,
} from './api.ts';

// Ключи запросов не содержат реквизитов: только идентификаторы, режим списка и выбранные фильтры.
const DOCUMENTS = 'documents';

/** Список документов под фильтры и выбранный в шапке режим «Всё · Общее · Личное»; постранично. */
export function useDocumentsList(filters: Omit<DocumentFilters, 'scope'>, trash = false) {
  const { scope } = useScope();
  const full: DocumentFilters = { ...filters, scope: listScopeOf(scope) };
  return useInfiniteQuery({
    queryKey: [DOCUMENTS, 'list', full, trash],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchDocuments(full, { trash, offset: pageParam }, signal),
    getNextPageParam: (last: DocumentCard[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: [DOCUMENTS, 'card', id],
    queryFn: ({ signal }) => fetchDocument(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/** Цепочка версий документа: от первой к последней. */
export function useVersions(id: string, enabled = true) {
  return useQuery({
    queryKey: [DOCUMENTS, 'versions', id],
    queryFn: ({ signal }) => fetchVersions(id, signal),
    enabled,
  });
}

/** Действующие документы объекта-владельца. */
export function useObjectDocuments(objectId: string) {
  return useQuery({
    queryKey: [DOCUMENTS, 'object', objectId],
    queryFn: ({ signal }) => fetchObjectDocuments(objectId, signal),
  });
}

/** Что перечитать после изменения документа: списки, карточки, версии, файлы, радар и корзину. */
export function useRefreshDocuments() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [DOCUMENTS] }),
      client.invalidateQueries({ queryKey: ['files'] }),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]);
}
