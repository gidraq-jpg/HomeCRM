import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import { seedDocument } from './documents-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedOrganization, seedPerson } from './people-support.ts';
import { seedProperty } from './property-support.ts';
import { checkApp, signInAs } from './support.ts';

// Общий CI: только обычный текст, открытие и сохранение каждой формы.
// Матрица 200%, клавиатура и размеры полей — e2e/fullscreen-forms/full-matrix.ts.
test.afterEach(async ({ page }) => {
  await page.close();
});

async function checkForm(page: Page, info: TestInfo, name: string) {
  await expect(page.locator('form button[type="submit"]')).toBeVisible();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('form button[type="submit"]')).toBeInViewport({ ratio: 1 });
  await checkApp(page, info, name);
}

test('UI-7: короткая проверка всех форм создания', async ({ page, family }, info) => {
  test.setTimeout(60_000);
  await signInAs(page, family, 'adult');
  await page.goto('#/home/from-template');
  await expect(page.getByRole('list', { name: 'Шаблоны' })).toBeVisible();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeVisible();
  const templateTitle = await page
    .locator('a[href="#/home/from-template/apartment"] .row__title')
    .innerText();

  for (const [name, route] of [
    ['task', '/today/new'],
    ['note', '/more/notes/new'],
    ['object', '/home/new'],
    ['document', '/documents/new'],
    ['person', '/people/contacts/new'],
    ['organization', '/more/organizations/new'],
    ['template', '/home/from-template/apartment'],
  ]) {
    await page.goto(`#${route}`);
    await checkForm(page, info, `ui7-new-${name}`);
    if (name === 'template') {
      await expect(page.locator('.ui7-form-heading')).toContainText(templateTitle);
      await page.getByLabel('Адрес', { exact: true }).fill('ул. Примерная, 12');
      while (await page.locator('form input[type="checkbox"]:checked').count())
        await page.locator('form input[type="checkbox"]:checked').first().uncheck();
    }
    if (name === 'document')
      await page.getByRole('checkbox', { name: 'Бессрочный', exact: true }).check();
    const title = `Вымышленная запись ${name}`;
    await page.locator('form input[type="text"], form input:not([type])').first().fill(title);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
  }
});

test('UI-7: короткая проверка всех форм правки', async ({ page, family }, info) => {
  test.setTimeout(60_000);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, { title: 'Вымышленный объект' });
  const note = await seedNote(api, family, { title: 'Вымышленная заметка', body: 'Памятка' });
  const person = await seedPerson(api, { title: 'Вымышленный человек' });
  const organization = await seedOrganization(api, { title: 'Вымышленная организация' });
  const doc = await seedDocument(api, {
    title: 'Вымышленный документ',
    type: 'other',
    indefinite: true,
  });
  const task = await api.post('tasks', { title: 'Вымышленное дело' });
  expect(task.status).toBe(201);
  await signInAs(page, family, 'adult');
  for (const [name, route] of [
    ['task', `/today/tasks/${(task.body as { id: string }).id}`],
    ['note', `/more/notes/${note.id}`],
    ['object', `/home/${object.id}`],
    ['document', `/documents/${doc.id}`],
    ['person', `/people/contacts/${person.id}`],
    ['organization', `/more/organizations/${organization.id}`],
  ]) {
    await page.goto(`#${route}`);
    const status =
      name === 'document' ? await page.locator('.object-hero__meta .status').innerText() : '';
    await page
      .locator('.object-hero__actions')
      .getByRole('button', { name: /^Править/ })
      .click();
    await checkForm(page, info, `ui7-edit-${name}`);
    if (name === 'document') {
      const badge = page.locator('.ui7-form-heading .status');
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(status);
    }
    const title = `Вымышленная правка ${name}`;
    await page.locator('form input[type="text"], form input:not([type])').first().fill(title);
    await page.locator('form button[type="submit"]').click();
    await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
    await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
  }
});
