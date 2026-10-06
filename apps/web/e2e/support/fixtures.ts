import { test as base, expect } from '@playwright/test';

// Расширенный `test`: на каждой странице следит за консолью и сетью. Тест падает, если
// в консоли появилась ошибка, страница бросила исключение, какой-то запрос закончился ошибкой
// или ушёл на чужой адрес: прототип не должен делать внешних запросов (задача 0.5).

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    // Старые сценарии прототипа проверяют оболочку. Вход проверяется отдельно с настоящим API.
    await page.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const me = {
        id: 'fictional-adult',
        displayName: 'Борис',
        username: 'boris',
        email: null,
        twoFactorEnabled: false,
        secondFactorRequired: false,
        roles: [{ householdId: 'fictional-home', role: 'adult' }],
        timeZone: 'Asia/Yekaterinburg',
        passwordReset: null,
      };
      const data =
        path === '/api/auth/get-session' ? { user: { id: me.id } } : path === '/api/me' ? me : [];
      return route.fulfill({ json: data });
    });
    const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
    const problems: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      // StrictMode отменяет первую проверку сессии при повторном монтировании.
      if (
        new URL(request.url()).pathname.startsWith('/api/') &&
        request.failure()?.errorText === 'net::ERR_ABORTED'
      )
        return;
      problems.push(`request failed: ${request.url()} (${request.failure()?.errorText ?? '?'})`);
    });
    page.on('response', (response) => {
      if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      const local = url.protocol === 'data:' || url.protocol === 'blob:' || url.origin === origin;
      if (!local) problems.push(`external request: ${request.url()}`);
    });

    await use(page);
    expect(problems, 'консоль и сеть должны быть чистыми').toEqual([]);
  },
});

export { expect };
