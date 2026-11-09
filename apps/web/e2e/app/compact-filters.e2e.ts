import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  setScope,
  settle,
} from '../support/helpers.ts';
import { seedDocument } from './documents-support.ts';
import { apiAs } from './notes-support.ts';
import { seedOrganization, seedPerson } from './people-support.ts';
import { signInAs } from './support.ts';

test('Компактные фильтры: применение, отмена, вкладки и мобильная геометрия', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Матрица выполняется один раз.');
  test.setTimeout(240_000);
  const api = await apiAs(family, 'adult');
  await seedDocument(api, {
    title: 'Договор учебной квартиры',
    type: 'contract',
    indefinite: true,
  });
  await seedDocument(api, {
    title: 'Загранпаспорт Бориса',
    type: 'international_passport',
    indefinite: true,
  });
  await seedPerson(api, { title: 'Мастер Солнечный', data: { categories: ['craftsperson'] } });
  await seedPerson(api, { title: 'Врач Светлана', data: { categories: ['doctor'] } });
  await seedOrganization(api, { title: 'Учебная клиника', data: { organizationType: 'clinic' } });
  await signInAs(page, family, 'adult');
  const filter = page.getByRole('button', { name: /^Фильтры/ });
  await page.goto('#/documents');
  await filter.click();
  await page.getByLabel('Тип', { exact: true }).selectOption('contract');
  await page.keyboard.press('Escape');
  await expect(filter).toBeFocused();
  await expect(filter).toHaveText('Фильтры');
  await filter.click();
  await expect(page.getByLabel('Тип', { exact: true })).toHaveValue('');
  await page.getByLabel('Тип', { exact: true }).selectOption('contract');
  await page.getByRole('radio', { name: 'Все версии', exact: true }).check();
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(filter).toHaveText('Фильтры · 2');
  await expect(filter).toBeFocused();
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  await filter.click();
  await expect(page.getByRole('radio', { name: 'Действующие', exact: true })).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: /^Истекают/ }).check();
  await expect(filter).toHaveText('Фильтры · 1');
  await page.getByRole('radio', { name: 'Все', exact: true }).check();
  await expect(filter).toHaveText('Фильтры');
  await page.goto('#/people');
  await expect(page.getByRole('radio', { name: 'Контакты', exact: true })).toBeChecked();
  await filter.click();
  await page.getByRole('radio', { name: 'Организации', exact: true }).check();
  await page.keyboard.press('Escape');
  await filter.click();
  await expect(page.getByRole('radio', { name: 'Все', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: 'Мастера', exact: true }).check();
  await page.evaluate(() => {
    const original = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.closest('[data-content-motion]') && !this.closest('[data-sheet]'))
        document.documentElement.dataset.contactsAnimated = 'true';
      return original.call(this, frames, options);
    };
  });
  await page.getByRole('button', { name: 'Применить', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Контакты' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-contacts-animated', 'true');
  await page.getByLabel('Поиск по ФИО и названию').fill('Солнечный');
  await page.getByRole('radio', { name: 'Участники дома', exact: true }).check();
  await expect(page.getByRole('list', { name: 'Участники дома' })).toBeVisible();
  await page.getByRole('radio', { name: 'Контакты', exact: true }).check();
  await expect(page.getByLabel('Поиск по ФИО и названию')).toHaveValue('Солнечный');
  await expect(page.getByRole('button', { name: 'Снять фильтр: Мастера' })).toBeVisible();
  await page.getByRole('radio', { name: 'Участники дома', exact: true }).check();
  await setScope(page, 'Личное');
  await expect(page.getByRole('list', { name: 'Участники дома' })).toHaveCount(0);
  await expect(page.getByLabel('Поиск по ФИО и названию')).toBeVisible();
  await setScope(page, 'Всё');
  await page.getByRole('button', { name: 'Сбросить', exact: true }).click();
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    for (const percent of [100, 200]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, percent);
      for (const route of ['documents', 'people']) {
        await page.goto(`#/${route}`);
        await expect(filter).toBeVisible();
        await expect(page.getByRole('status', { name: /^Загружаем/ })).toHaveCount(0);
        await settle(page);
        await page.screenshot({
          path: info.outputPath(`${route}-${width}-${percent}.png`),
          fullPage: true,
        });
        await expectAccessible(page, 'Компактные фильтры');
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        await filter.click();
        await expect(page.getByRole('status', { name: /^Загружаем/ })).toHaveCount(0);
        await settle(page);
        await page.screenshot({
          path: info.outputPath(`${route}-filters-${width}-${percent}.png`),
          fullPage: true,
        });
        await expectAccessible(page, 'Компактные фильтры');
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        await page.keyboard.press('Escape');
        if (route === 'people') {
          await page.getByRole('radio', { name: 'Участники дома', exact: true }).check();
          await settle(page);
          await page.screenshot({
            path: info.outputPath(`members-${width}-${percent}.png`),
            fullPage: true,
          });
          await expectAccessible(page, 'Компактные фильтры');
          await expectNoHorizontalScroll(page);
          await expectTouchTargets(page);
        }
      }
    }
  }
});
