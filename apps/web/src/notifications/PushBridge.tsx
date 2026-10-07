import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { OPEN_MESSAGE, safeRoute } from '../pwa/push-message.ts';
import { resyncPush } from './push.ts';

/**
 * Связь страницы с сервис-воркером: нажатие на уведомление открывает карточку записи в уже открытом окне, а
 * запуск приложения привязывает подписку браузера к новой сессии. Ничего не рисует.
 */
export function PushBridge({ accountId }: { accountId: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (!data || typeof data !== 'object' || !('type' in data) || data.type !== OPEN_MESSAGE)
        return;
      // Воркер — наш, но маршрут проверяем всё равно: переходим только по известным формам.
      const route = safeRoute('route' in data ? data.route : null);
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
