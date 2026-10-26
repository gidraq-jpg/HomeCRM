import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test('D30: системная история сохраняет HashRouter без перехвата жеста', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Проверка системной истории', planOn: homeDate(0) });
  await signInAs(page, family, 'adult');
  await page.getByRole('link', { name: 'Проверка системной истории', exact: true }).click();
  await settle(page);
  await page.evaluate(() => {
    const navigation = Reflect.get(window, 'navigation') as EventTarget | undefined;
    document.documentElement.dataset.navigationApi = String(!!navigation);
    navigation?.addEventListener('navigate', (event) => {
      document.documentElement.dataset.navigationProbe = JSON.stringify({
        type: Reflect.get(event, 'navigationType'),
        hashChange: Reflect.get(event, 'hashChange'),
        canIntercept: Reflect.get(event, 'canIntercept'),
        uaTransition: Reflect.get(event, 'hasUAVisualTransition'),
      });
    });
    window.addEventListener(
      'popstate',
      (event) => {
        document.documentElement.dataset.popstateProbe = JSON.stringify({
          heading: document.querySelector('h1')?.textContent,
          uaTransition: Reflect.get(event, 'hasUAVisualTransition'),
        });
      },
      { capture: true, once: true },
    );
  });
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-motion-direction');
  await page.goForward();
  await expect(
    page.getByRole('heading', { name: 'Проверка системной истории', exact: true }),
  ).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-motion-direction');
  const probe = await page.locator('html').evaluate((node) => ({ ...node.dataset }));
  const dir = resolve(import.meta.dirname, '../../test-results/screens/D30');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `history-${info.project.name}.json`);
  await writeFile(path, `${JSON.stringify(probe, null, 2)}\n`);
  await info.attach('history-chromium', { path, contentType: 'application/json' });
});
