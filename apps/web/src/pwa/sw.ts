/// <reference lib="webworker" />
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

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
