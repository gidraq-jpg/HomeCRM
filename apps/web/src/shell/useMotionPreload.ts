import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { fetchDocument, fetchDocuments } from '../documents/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { fetchNote, fetchNotes } from '../notes/api.ts';
import { listScopeOf } from '../notes/queries.ts';
import { fetchObject, fetchObjects } from '../objects/api.ts';
import { fetchContact, fetchContacts } from '../people/api.ts';
import { fetchTask, fetchToday } from '../tasks/api.ts';

/** Запросы используют те же ключи и проверку доступа, что экран. Маршруты уже импортированы App. */
export function useMotionPreload() {
  const client = useQueryClient();
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  useEffect(() => {
    const requests = new Map<string, Promise<unknown>>();
    let pending = 0;
    let active = true;
    const bypass = new WeakSet<HTMLAnchorElement>();
    const preload = (link: HTMLAnchorElement) => {
      const path = link.hash.slice(1).split('?')[0] ?? '';
      const listScope = listScopeOf(scope);
      const id = path.split('/').at(-1) ?? '';
      const card = (queryKey: readonly unknown[], queryFn: () => Promise<unknown>) =>
        client.prefetchQuery({ queryKey, queryFn, staleTime: 30_000 });
      const list = (queryKey: readonly unknown[], queryFn: () => Promise<unknown>) =>
        client.prefetchInfiniteQuery({ queryKey, queryFn, initialPageParam: 0, staleTime: 30_000 });
      let request: Promise<unknown> | undefined;
      if (/^\/today\/tasks\/[^/]+$/.test(path))
        request = card(['tasks', me.id, 'card', id], () => fetchTask(id));
      else if (/^\/home\/[^/]+$/.test(path) && !['new', 'month', 'from-template'].includes(id))
        request = card(['objects', 'card', id], () => fetchObject(id));
      else if (/^\/more\/notes\/[^/]+$/.test(path) && id !== 'new')
        request = card(['notes', 'card', id], () => fetchNote(id));
      else if (/^\/documents\/[^/]+$/.test(path) && id !== 'new')
        request = card(['documents', 'card', id], () => fetchDocument(id));
      else if (/^\/people\/contacts\/[^/]+$/.test(path) && !['new', 'import'].includes(id))
        request = card(['contacts', 'card', id], () => fetchContact(id));
      else if (path === '/home')
        request = list(['objects', 'list', listScope, false], () =>
          fetchObjects(listScope, { trash: false, offset: 0 }),
        );
      else if (path === '/more/notes')
        request = list(['notes', 'list', listScope, false], () =>
          fetchNotes(listScope, { trash: false, offset: 0 }),
        );
      else if (path === '/documents')
        request = list(
          [
            'documents',
            'list',
            {
              scope: listScope,
              memberId: null,
              type: null,
              expiry: null,
              status: 'valid',
              query: '',
            },
            false,
          ],
          () =>
            fetchDocuments(
              {
                scope: listScope,
                memberId: null,
                type: null,
                expiry: null,
                status: 'valid',
                query: '',
              },
              { trash: false, offset: 0 },
            ),
        );
      else if (path === '/people')
        request = list(
          ['contacts', 'list', { scope: listScope, kind: null, category: null, query: '' }, false],
          () =>
            fetchContacts(
              { scope: listScope, kind: null, category: null, query: '' },
              { trash: false, offset: 0 },
            ),
        );
      else if (path === '/today')
        request = card(['tasks', me.id, householdId, 'today', scope], () =>
          fetchToday(listScope, householdId),
        );
      if (request) requests.set(link.href, request);
      return request;
    };
    const anchor = (event: MouseEvent) => {
      const direct =
        event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (
        direct ||
        event.target !== document.documentElement ||
        !document.documentElement.dataset.motionDirection
      )
        return direct;
      // Снимок Chromium адресует касание корню. Панель остаётся доступна по прежним границам.
      return (
        [...document.querySelectorAll<HTMLAnchorElement>('.bottom-nav a, .side-nav a')].find(
          (link) => {
            const rect = link.getBoundingClientRect();
            return (
              rect.width > 0 &&
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            );
          },
        ) ?? null
      );
    };
    const down = (event: PointerEvent) => {
      const link = anchor(event);
      if (
        link &&
        event.button === 0 &&
        link.origin === location.origin &&
        link.hash.startsWith('#/')
      )
        preload(link);
    };
    const click = (event: MouseEvent) => {
      const link = anchor(event);
      if (
        !link ||
        bypass.delete(link) ||
        event.defaultPrevented ||
        event.button ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        link.target ||
        link.origin !== location.origin ||
        !link.hash.startsWith('#/')
      )
        return;
      const request = requests.get(link.href) ?? preload(link);
      if (!request) {
        if (event.target === document.documentElement) {
          event.preventDefault();
          event.stopImmediatePropagation();
          bypass.add(link);
          link.click();
        }
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      // Ошибка предзагрузки остаётся в Query: целевой экран показывает штатное сообщение.
      const sourceUrl = location.href;
      const href = link.href;
      pending++;
      document.documentElement.dataset.motionPending = 'true';
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 150));
      void Promise.race([request, timeout]).then(() => {
        setTimeout(() => {
          requests.delete(link.href);
          const target = link.isConnected
            ? link
            : location.href === sourceUrl
              ? [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
                  (candidate) => candidate.href === href,
                )
              : undefined;
          const sameRoute = location.href === sourceUrl || !!link.closest('.bottom-nav, .side-nav');
          if (active && target && sameRoute) {
            bypass.add(target);
            target.click();
          }
          if (--pending === 0) delete document.documentElement.dataset.motionPending;
        }, 0);
      });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('click', click, true);
    return () => {
      active = false;
      delete document.documentElement.dataset.motionPending;
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('click', click, true);
    };
  }, [client, me.id, householdId, scope]);
}

export function MotionPreload() {
  useMotionPreload();
  return null;
}
