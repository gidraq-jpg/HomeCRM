export function registerShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener(
    'load',
    () => {
      void navigator.serviceWorker
        .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
        .catch(() => {
          // Сбой регистрации оболочки не закрывает вход. Отдельная плашка сообщает о недоступности офлайн.
          const notice = document.createElement('p');
          notice.className = 'auth-notice';
          notice.setAttribute('role', 'status');
          notice.textContent =
            'Не удалось подготовить работу без сети. При следующем открытии попробуем ещё раз.';
          document.body.append(notice);
        });
    },
    { once: true },
  );
}
