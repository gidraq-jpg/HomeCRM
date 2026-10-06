import { test as base, expect } from '@playwright/test';

// Расширенный `test`: на каждой странице следит за консолью и сетью. Тест падает, если
// в консоли появилась ошибка, страница бросила исключение, какой-то запрос закончился ошибкой
// или ушёл на чужой адрес: прототип не должен делать внешних запросов (задача 0.5).

export const test = base.extend({
  page: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL ?? 'http://127.0.0.1').origin;
    const problems: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        problems.push(`console.${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
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
