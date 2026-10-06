import { test as base, expect } from '@playwright/test';
import { createFamily, type Family } from './family.ts';

export const test = base.extend<{ family: Family }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright требует явную деструктуризацию зависимостей fixture.
  family: async ({}, use) => {
    const family = await createFamily();
    try {
      await use(family);
    } finally {
      await family.close();
    }
  },
  baseURL: async ({ family }, use) => {
    await use(family.baseURL);
  },
  page: async ({ page, family }, use) => {
    const errors: string[] = [];
    page.on('pageerror', () => errors.push('Unhandled browser exception'));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
        errors.push('Unexpected console error');
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (!['data:', 'blob:'].includes(url.protocol) && url.origin !== family.origin)
        errors.push('External request');
    });
    page.on('response', (response) => {
      if (response.status() >= 400 && !new URL(response.url()).pathname.startsWith('/api/'))
        errors.push('Static asset failed');
    });
    await use(page);
    expect(errors, 'ошибки браузера и внешние запросы').toEqual([]);
  },
});
export { expect };
