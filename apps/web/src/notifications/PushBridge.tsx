import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { routeFromMessage } from '../pwa/push-message.ts';
import { resyncPush } from './push.ts';

/**
 * Связь страницы с сервис-воркером: нажатие на уведомление открывает карточку записи в уже открытом окне, а
 * запуск приложения привязывает подписку браузера к новой сессии. Ничего не рисует. Пока участник не вошёл,
 * маршрут из уведомления запоминает `usePendingRoute` (AuthRoot) и открывает после входа.
 */
export function PushBridge({ accountId }: { accountId: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      // Воркер — наш, но маршрут проверяем всё равно: переходим только по известным формам.
      const route = routeFromMessage(event.data);
      if (route) navigate(route);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);

  useEffect(() => {
    // Не вышло (нет сети, воркер не готов) — не страшно: повторим при следующем запуске приложения.
    resyncPush(accountId).catch(() => undefined);
  }, [accountId]);

  return null;
}
