import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ContactCard,
  fetchOrganization,
  fetchOrganizations,
  type OrganizationType,
  PAGE_SIZE,
} from './api.ts';

// Ключи запросов не содержат названий, телефонов и адресов: только идентификаторы и режим списка.
const ORGANIZATIONS = 'organizations';

/** Список организаций (постранично) с фильтром по типу; режим «Всё · Общее · Личное» применяет экран. */
export function useOrganizationsList(trash: boolean, organizationType: OrganizationType | null) {
  return useInfiniteQuery({
    queryKey: [ORGANIZATIONS, 'list', trash, organizationType],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchOrganizations(
        { trash, offset: pageParam, ...(organizationType ? { organizationType } : {}) },
        signal,
      ),
    getNextPageParam: (last: ContactCard[], pages) =>
      last.length < PAGE_SIZE ? undefined : pages.length * PAGE_SIZE,
  });
}

export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: [ORGANIZATIONS, 'card', id],
    queryFn: ({ signal }) => fetchOrganization(id ?? '', signal),
    enabled: id !== undefined,
  });
}

/** Живые организации для выбора поставщика и связи с объектом: первая страница, по названию. */
export function useOrganizationOptions(enabled = true) {
  return useQuery({
    queryKey: [ORGANIZATIONS, 'options'],
    queryFn: ({ signal }) => fetchOrganizations({ trash: false, offset: 0 }, signal),
    enabled,
  });
}

/** Что перечитать после изменения организации: списки, карточки, корзину, объекты, счета и связи. */
export function useRefreshOrganizations() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [ORGANIZATIONS] }),
      client.invalidateQueries({ queryKey: ['objects'] }),
      client.invalidateQueries({ queryKey: ['accounts'] }),
      client.invalidateQueries({ queryKey: ['links'] }),
    ]);
}
