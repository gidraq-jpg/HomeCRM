import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { routeFromMessage, safeRoute } from '../pwa/push-message.ts';

/**
 * Переход из уведомления до входа (NOTIF-1). Нажатие на уведомление при открытом экране входа не должно
 * терять запись: маршрут запоминается в памяти страницы и открывается сразу после входа. Маршруты —
 * только известные формы (`/open/<uuid>`, радар); в хранилища браузера они не пишутся.
 *
 * `signedOut` — сессии точно нет (проверка завершена); пока она идёт, ничего не запоминаем.
 * Возвращает функцию «забрать»: отдаёт запомненный маршрут (или `null`) и забывает его.
 */
export function usePendingRoute(signedOut: boolean) {
  const pending = useRef<string | null>(null);
  const { pathname } = useLocation();

  // Окно открыто по уведомлению заново: маршрут уже в адресе, но экран входа его не покажет.
  useEffect(() => {
    if (!signedOut) return;
    const route = safeRoute(pathname);
    if (route) pending.current = route;
  }, [signedOut, pathname]);

  // Окно уже было открыто на экране входа: воркер присылает маршрут сообщением.
  useEffect(() => {
    if (!signedOut || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const route = routeFromMessage(event.data);
      if (route) pending.current = route;
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [signedOut]);

  return useCallback(() => {
    const route = pending.current;
    pending.current = null;
    return route;
  }, []);
}
