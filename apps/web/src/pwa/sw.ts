/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { deviceName } from './device-name.ts';
import { keyToBytes } from './push-key.ts';
import { describePush, OPEN_MESSAGE, parsePushData, targetRoute } from './push-message.ts';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

// Только файлы сборки. Нет стратегии для API, POST, ответов входа или пользовательских данных.
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [] });
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api(?:\/|$)/, /^\/health(?:\/|$)/],
  }),
);
// Ссылки с токенами получают общий index.html: их адрес и ответ в кэш не записываются.
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Push (NOTIF-1, NOTIF-6, ADR-0009). Содержимое push не попадает в кэш, консоль и хранилища: оно живёт
// только в самом уведомлении. Текст по умолчанию — «В HomeCRM есть новое» (его выбирает сервер).
self.addEventListener('push', (event) => {
  const push = describePush(parsePushData(event.data));
  const icon = new URL('icon-192.png', self.registration.scope).href;
  // Каждый push обязан показать уведомление (userVisibleOnly): даже пустой или неразборчивый.
  // `renotify` — повторное предупреждение о той же записи снова привлекает внимание, а не тихо подменяет прежнее.
  const options: NotificationOptions & { renotify: boolean } = {
    body: push.body,
    icon,
    badge: icon,
    tag: push.tag,
    renotify: true,
    lang: 'ru',
    data: { recordId: push.recordId },
  };
  event.waitUntil(self.registration.showNotification(push.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = targetRoute(describePush(event.notification.data).recordId);
  event.waitUntil(openApp(route));
});

/** Открытое окно приложения получает маршрут сообщением (без перезагрузки), закрытого — открываем заново. */
async function openApp(route: string): Promise<void> {
  const scope = self.registration.scope;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => client.url.startsWith(scope));
  if (!open) {
    await self.clients.openWindow(`${scope}#${route}`);
    return;
  }
  try {
    await open.focus();
  } catch {
    // Браузер мог не разрешить вынести окно вперёд; маршрут всё равно передаём, человек увидит его при возврате.
  }
  open.postMessage({ type: OPEN_MESSAGE, route });
}

// Служба push сменила или сбросила подписку: оформляем новую и сообщаем серверу. Если не вышло (нет сети,
// вход истёк), страница переподпишет устройство при следующем открытии.
interface SubscriptionChange extends ExtendableEvent {
  newSubscription?: PushSubscription | null;
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event as SubscriptionChange));
});

async function resubscribe(event: SubscriptionChange): Promise<void> {
  const subscription =
    event.newSubscription ??
    (await (async () => {
      const response = await fetch('/api/push/key', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Push key is unavailable');
      const { publicKey } = (await response.json()) as { publicKey: string };
      return self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(publicKey),
      });
    })());
  const { endpoint, keys } = subscription.toJSON();
  const saved = await fetch('/api/push/subscriptions', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, keys, deviceName: deviceName(self.navigator.userAgent) }),
  });
  if (!saved.ok) throw new Error('Push subscription was not saved');
}
