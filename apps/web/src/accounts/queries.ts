import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope } from '../access/scope.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { listScopeOf } from '../notes/queries.ts';
import { fetchObjects } from '../objects/api.ts';
import { type AccountCard, fetchAccounts } from './api.ts';

// Ключи запросов не содержат названий, номеров и ссылок: только идентификаторы и режим списка.
const ACCOUNTS = 'accounts';

/** Лицевые счета объекта. Корзина счетов объекта — `trash`. */
export function useAccounts(objectId: string, trash = false) {
  return useQuery({
    queryKey: [ACCOUNTS, objectId, trash],
    queryFn: ({ signal }) => fetchAccounts(objectId, trash, signal),
  });
}

export interface TrashedAccount {
  account: AccountCard;
  objectId: string;
  /** Название объекта показывается в корзине, чтобы было понятно, откуда счёт. */
  objectTitle: string;
}

/**
 * Лицевые счета в корзине. Общего списка у API нет, поэтому счета запрашиваются по живым объектам
 * недвижимости (в выбранном режиме «Всё · Общее · Личное»). Счета удалённого объекта сюда не
 * входят: они вернутся вместе с объектом.
 */
export function useTrashedAccounts() {
  const { scope } = useScope();
  const listScope = listScopeOf(scope);
  return useQuery({
    queryKey: [ACCOUNTS, 'trash', listScope],
    queryFn: async ({ signal }): Promise<TrashedAccount[]> => {
      const objects = (await fetchObjects(listScope, { trash: false, offset: 0 }, signal)).filter(
        (object) => object.objectType === 'property' && matchesScope(visibilityOf(object), scope),
      );
      const groups = await Promise.all(
        objects.map(async (object) =>
          (await fetchAccounts(object.id, true, signal)).map((account) => ({
            account,
            objectId: object.id,
            objectTitle: object.title,
          })),
        ),
      );
      return groups.flat();
    },
  });
}

/** Что перечитать после изменения счёта: списки счетов, корзину и карточки объектов. */
export function useRefreshAccounts() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [ACCOUNTS] }),
      client.invalidateQueries({ queryKey: ['objects'] }),
    ]);
}
