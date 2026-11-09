import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useScope } from './access/ScopeContext.tsx';
import type { Scope } from './access/scope.ts';
import { NO_FILTERS } from './documents/api.ts';
import { documentsListOptions } from './documents/queries.ts';
import { useHousehold } from './household/HouseholdContext.tsx';
import { listScopeOf } from './notes/queries.ts';
import { objectsListOptions } from './objects/queries.ts';
import { contactsListOptions } from './people/queries.ts';
import { todayOptions } from './tasks/queries.ts';

/**
 * После входа списки главных разделов подгружаются в фоне (D48, ADR-0007): первый экран не ждёт,
 * а переход в «Дом», «Документы» и «Людей» показывает данные сразу. Ключи те же, что у экранов, и
 * включают пространство, поэтому данные одного пространства не попадают в другое. Сбой
 * подгрузки молчит: экран сам запросит данные и покажет ошибку в своём блоке.
 */
export function prefetchSections(
  client: QueryClient,
  who: { meId: string; householdId: string | null; scope: Scope },
): Promise<unknown> {
  const listScope = listScopeOf(who.scope);
  return Promise.allSettled([
    client.prefetchQuery(todayOptions(who.meId, who.householdId, who.scope)),
    client.prefetchInfiniteQuery(objectsListOptions(listScope, false)),
    client.prefetchInfiniteQuery(documentsListOptions({ ...NO_FILTERS, scope: listScope }, false)),
    client.prefetchInfiniteQuery(
      contactsListOptions({ kind: null, category: null, query: '', scope: listScope }, false),
    ),
  ]);
}

/** Запускает подгрузку после первой отрисовки, не блокируя её; при смене пространства — заново. */
export function useSectionPrefetch(): void {
  const client = useQueryClient();
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  useEffect(() => {
    const timer = setTimeout(() => {
      void prefetchSections(client, { meId: me.id, householdId, scope });
    }, 300);
    return () => clearTimeout(timer);
  }, [client, me.id, householdId, scope]);
}
