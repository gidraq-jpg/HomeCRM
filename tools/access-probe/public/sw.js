// Service worker заглушки: только push. Кэш и офлайн здесь не нужны.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function readPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener('push', (event) => {
  const receivedAt = Date.now();
  const data = readPayload(event);
  const latencySec =
    typeof data.sentAt === 'number' ? Math.max(0, (receivedAt - data.sentAt) / 1000) : null;
  const body =
    latencySec === null
      ? 'Тестовое уведомление'
      : `Дошло за ${latencySec.toFixed(1).replace('.', ',')} с`;

  const ack = data.pushId
    ? fetch('api/push-ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pushId: data.pushId, receivedAt }),
      }).catch(() => undefined)
    : Promise.resolve();

  const tellPages = self.clients.matchAll({ type: 'window' }).then((clients) => {
    for (const client of clients) client.postMessage({ type: 'push', latencySec });
  });

  event.waitUntil(
    Promise.all([
      self.registration.showNotification('HomeCRM: проверка связи', {
        body,
        icon: 'icon-192.png',
        tag: data.pushId ?? 'probe',
      }),
      ack,
      tellPages,
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('./'));
});
