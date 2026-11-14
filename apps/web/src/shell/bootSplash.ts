// Разметка заставки в index.html: она появляется до загрузки React.
const EXIT_START_MS = 2040;
// Запасной таймер нужен, если вкладка в фоне и animationend не пришёл.
const EXIT_FALLBACK_MS = 900;

/** Запускает уход заставки после проверки сессии и появления логотипа. */
export function hideBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.dataset.state) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    splash.remove();
    return;
  }

  splash.dataset.state = 'ready';
  const start = performance.getEntriesByName('homecrm-splash-start', 'mark')[0];
  const elapsed = start ? performance.now() - start.startTime : EXIT_START_MS;

  window.setTimeout(
    () => {
      splash.addEventListener('animationend', (event) => {
        if (event.animationName === 'boot-dissolve') splash.remove();
      });
      splash.dataset.state = 'closing';
      window.setTimeout(() => splash.remove(), EXIT_FALLBACK_MS);
    },
    Math.max(0, EXIT_START_MS - elapsed),
  );
}
