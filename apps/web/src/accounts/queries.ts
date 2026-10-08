import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope } from '../access/scope.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { listScopeOf } from '../notes/queries.ts';
import { fetchObjects } from '../objects/api.ts';
import { type AccountCard, fetchAccounts, fetchTrashedAccounts } from './api.ts';

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
 * Лицевые счета в корзине: один `GET /api/accounts?trash=true`. Название объекта берётся из списка
 * живой недвижимости в выбранном режиме «Всё · Общее · Личное»; счета объектов в корзине сюда не
 * входят — они вернутся вместе с объектом.
 */
export function useTrashedAccounts() {
  const { scope } = useScope();
  const listScope = listScopeOf(scope);
  return useQuery({
    queryKey: [ACCOUNTS, 'trash', listScope],
    queryFn: async ({ signal }): Promise<TrashedAccount[]> => {
      const [accounts, objects] = await Promise.all([
        fetchTrashedAccounts(signal),
        fetchObjects(listScope, { trash: false, offset: 0 }, signal),
      ]);
      const titles = new Map(
        objects
          .filter((object) => object.objectType === 'property')
          .map((object) => [object.id, object.title] as const),
      );
      return accounts.flatMap((account) => {
        const objectTitle = titles.get(account.parentId);
        return objectTitle !== undefined && matchesScope(visibilityOf(account), scope)
          ? [{ account, objectId: account.parentId, objectTitle }]
          : [];
      });
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
