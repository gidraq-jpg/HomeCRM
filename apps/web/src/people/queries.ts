import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { listScopeOf } from '../notes/queries.ts';
import {
  type ContactFilters,
  fetchContact,
  fetchContacts,
  fetchInteractions,
  fetchPeopleOptions,
  type Interaction,
  PAGE_SIZE,
} from './api.ts';
import type { AnyContact } from './schema.ts';

// Ключи запросов не содержат ФИО, названий и текстов: только идентификаторы, режим списка и
// выбранные фильтры (поиск — строка запроса, но в ключе она лежит только в памяти страницы).
const CONTACTS = 'contacts';

/** Список людей и организаций под фильтры и режим «Всё · Общее · Личное»; постранично. */
export function useContactsList(filters: Omit<ContactFilters, 'scope'>, trash = false) {
  const { scope } = useScope();
  const full: ContactFilters = { ...filters, scope: listScopeOf(scope) };
  return useInfiniteQuery({
    queryKey: [CONTACTS, 'list', full, trash],
    initialPageParam: 0,
    // Набор в поиске не заменяет экран на «Загружаем…»: прежний список виден, фокус на месте.
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam, signal }) => fetchContacts(full, { trash, offset: pageParam }, signal),
    getNextPageParam: (last: AnyContact[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: [CONTACTS, 'card', id],
    queryFn: ({ signal }) => fetchContact(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/** Живые люди для выбора владельца документа и организации: первая страница, по ФИО. */
export function usePeopleOptions(enabled = true) {
  return useQuery({
    queryKey: [CONTACTS, 'people-options'],
    queryFn: ({ signal }) => fetchPeopleOptions(signal),
    enabled,
  });
}

/** Лента взаимодействий контакта: страницами, новые сверху. */
export function useInteractions(contactId: string, trash = false, enabled = true) {
  return useInfiniteQuery({
    queryKey: [CONTACTS, 'interactions', contactId, trash],
    enabled,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => fetchInteractions(contactId, pageParam, signal, trash),
    getNextPageParam: (last: Interaction[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

/** Что перечитать после изменения контакта: списки, карточки, ленты, объекты, счета, документы и сроки. */
export function useRefreshContacts() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [CONTACTS] }),
      client.invalidateQueries({ queryKey: ['organizations'] }),
      client.invalidateQueries({ queryKey: ['objects'] }),
      client.invalidateQueries({ queryKey: ['accounts'] }),
      client.invalidateQueries({ queryKey: ['links'] }),
      client.invalidateQueries({ queryKey: ['documents'] }),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]);
}
