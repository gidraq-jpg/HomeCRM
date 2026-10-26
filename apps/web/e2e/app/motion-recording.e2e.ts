import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../auth/support/fixtures.ts';
import { settle } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

test.use({ reducedMotion: 'no-preference' });
test('D30: запись вперёд и назад для PR', async ({ page, family, browser }, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  await api.post('tasks', { title: 'Проверить показания', planOn: homeDate(0) });
  await signInAs(page, family, 'adult');
  const dir = resolve(
    import.meta.dirname,
    '../../test-results/screens/D30',
    process.env.D30_PHASE ?? 'after',
  );
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: info.project.use.viewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    reducedMotion: 'no-preference',
    recordVideo: { dir, size: info.project.use.viewport ?? undefined },
  });
  const demo = await context.newPage();
  try {
    await demo.goto(`${family.baseURL}#/today`);
    const task = demo.getByRole('link', { name: 'Проверить показания', exact: true });
    await expect(task).toBeVisible();
    await task.scrollIntoViewIfNeeded();
    await settle(demo);
    await demo.screenshot({
      path: resolve(dir, `list-${info.project.name}.png`),
      animations: 'disabled',
    });
    await task.click();
    await expect(
      demo.getByRole('heading', { name: 'Проверить показания', exact: true }),
    ).toBeVisible();
    await settle(demo);
    await demo.screenshot({
      path: resolve(dir, `card-${info.project.name}.png`),
      animations: 'disabled',
    });
    await demo.locator('.back-link').first().click();
    await expect(demo.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await settle(demo);
    await task.click();
    await settle(demo);
    await demo.locator('.back-link').first().click();
    await settle(demo);
  } finally {
    await context.close();
  }
  await demo.video()?.saveAs(resolve(dir, `navigation-${info.project.name}.webm`));
});
