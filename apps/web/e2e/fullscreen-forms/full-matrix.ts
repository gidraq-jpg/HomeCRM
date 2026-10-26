import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { seedDocument } from '../app/documents-support.ts';
import { apiAs, seedNote } from '../app/notes-support.ts';
import { seedOrganization, seedPerson } from '../app/people-support.ts';
import { seedProperty } from '../app/property-support.ts';
import { signInAs } from '../app/support.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openQuick,
} from '../support/helpers.ts';

// Закрываем страницу до удаления временной базы: опросы приложения не переживают сценарий.
test.afterEach(async ({ page }) => {
  await page.close();
});

const before = process.env.UI7_PHASE === 'before';
const forms = [
  ['task', '/today/new', '/today'],
  ['note', '/more/notes/new', '/more/notes'],
  ['object', '/home/new', '/home'],
  ['document', '/documents/new', '/documents'],
  ['person', '/people/contacts/new', '/people'],
  ['organization', '/more/organizations/new', '/more/organizations'],
  ['template', '/home/from-template/apartment', '/home/from-template'],
] as const;

async function ready(page: Page) {
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}
async function capture(page: Page, info: TestInfo, name: string, percent: number) {
  const dir = resolve(
    import.meta.dirname,
    '../../test-results/screens/UI-7',
    before ? 'before' : 'after',
  );
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(dir, `${name}${info.project.name === 'w412' ? '-w412' : ''}-${percent}.png`),
  });
}
async function checkKeyboard(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Viewport missing');
  await page.setViewportSize({ width: viewport.width, height: 450 });
  // Сохраняем портретную ориентацию: изменение screen.orientation означало бы поворот устройства.
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', 'open');
  const last = page
    .locator(
      'form input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):enabled, form textarea:enabled, form select:enabled',
    )
    .filter({ visible: true })
    .last();
  await last.focus();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect(last).toBeFocused();
  expect(
    await last.evaluate((field) => {
      const r = field.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === field;
    }),
  ).toBe(true);
  await page.setViewportSize(viewport);
}

async function checkForm(page: Page, info: TestInfo, name: string, percent: number) {
  await ready(page);
  if (!before) {
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, name);
    await expectTouchTargets(page);
    expect(
      await page.locator('.ui7-form-heading h1').evaluate((title) => {
        const available = title.parentElement?.getBoundingClientRect().width ?? 0;
        return title.getBoundingClientRect().width >= available * 0.75;
      }),
      'статус не сжимает заголовок до одного символа при 200%',
    ).toBe(true);
    await expect(page.locator('.topbar')).toBeHidden();
    await expect(page.locator('.bottom-nav')).toBeHidden();
    const submit = page.locator('form button[type="submit"]').first();
    await expect(submit).toBeInViewport({ ratio: 1 });
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(
      await submit.evaluate((button) => {
        const r = button.getBoundingClientRect();
        return (
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') ===
          button
        );
      }),
    ).toBe(true);
  }
  await capture(page, info, name, percent);
  if (!before) await checkKeyboard(page);
}

for (const percent of before ? [100] : [100, 200]) {
  test(`UI-7: все формы создания, возврат и сохранение · ${percent}%`, async ({
    page,
    family,
  }, info) => {
    test.setTimeout(300_000);
    await signInAs(page, family, 'adult');
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route, back] of forms) {
      await page.goto(`#${back}`);
      await ready(page);
      await page.goto(`#${route}`);
      await checkForm(page, info, `new-${name}`, percent);
      if (before) continue;
      const link = page.locator('.ui7-form-heading .back-link');
      await expect(link).toHaveAttribute('href', `#${back}`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${back}$`));
      await expect(page.locator('.topbar')).toBeVisible();
      await page.goto(`#${route}`);
      await ready(page);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`#${back}$`));
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
      await page.goto(`#${route}`);
      await ready(page);
      const title = `Вымышленная запись ${name} ${percent}`;
      await page.locator('form input[type="text"], form input:not([type])').first().fill(title);
      if (name === 'template') {
        await page.getByLabel('Адрес', { exact: true }).fill('ул. Примерная, 12');
        // Состав шаблона выбирает пользователь; здесь проверяем создание только объекта.
        while (await page.locator('form input[type="checkbox"]:checked').count())
          await page.locator('form input[type="checkbox"]:checked').first().uncheck();
      }
      if (name === 'document')
        await page.getByRole('checkbox', { name: 'Бессрочный', exact: true }).check();
      await page.locator('form button[type="submit"]').click();
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
    }
  });

  test(`UI-7: все формы правки, факты карточки и клавиатура · ${percent}%`, async ({
    page,
    family,
  }, info) => {
    test.setTimeout(300_000);
    const api = await apiAs(family, 'adult');
    const object = await seedProperty(api, family, { title: 'Вымышленный объект' });
    const note = await seedNote(api, family, {
      title: 'Вымышленная заметка',
      body: 'Памятка',
      audience: 'household',
    });
    const person = await seedPerson(api, { title: 'Вымышленный человек' });
    const organization = await seedOrganization(api, { title: 'Вымышленная организация' });
    const doc = await seedDocument(api, {
      title: 'Вымышленный документ',
      type: 'other',
      indefinite: true,
    });
    const taskResult = await api.post('tasks', {
      title: 'Проверить вымышленный фильтр',
      description: 'Памятка',
    });
    expect(taskResult.status).toBe(201);
    const task = taskResult.body as { id: string };
    const records = [
      ['task', `/today/tasks/${task.id}`, '/today'],
      ['note', `/more/notes/${note.id}`, '/more/notes'],
      ['object', `/home/${object.id}`, '/home'],
      ['document', `/documents/${doc.id}`, '/documents'],
      ['person', `/people/contacts/${person.id}`, '/people'],
      ['organization', `/more/organizations/${organization.id}`, '/more/organizations'],
    ] as const;
    await signInAs(page, family, 'adult');
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route, back] of records) {
      await page.goto(`#${back}`);
      await ready(page);
      await page.goto(`#${route}`);
      await ready(page);
      if (name === 'task') {
        if (!before) {
          await expectNoHorizontalScroll(page);
          const columns = await page
            .locator('.object-facts > div')
            .evaluateAll(
              (facts) => new Set(facts.map((f) => Math.round(f.getBoundingClientRect().x))).size,
            );
          if (info.project.name === 'w360' || percent === 200)
            expect(columns).toBeLessThanOrEqual(2);
          if (info.project.name === 'w412' && percent === 100) expect(columns).toBe(3);
        }
        await capture(page, info, 'task', percent);
      }
      await page
        .locator('.object-hero__actions')
        .getByRole('button', { name: /^Править/ })
        .click();
      await expect(page.locator('form button[type="submit"]')).toBeVisible();
      await checkForm(page, info, `edit-${name}`, percent);
      if (before) continue;
      // D30: «Назад» локальной формы правки закрывает режим и оставляет карточку.
      await page.locator('.ui7-form-heading .back-link').click();
      await expect(page).toHaveURL(new RegExp(`#${route}$`));
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
      await expect(
        page.locator('.object-hero__actions').getByRole('button', { name: /^Править/ }),
      ).toBeVisible();
      await page.goto(`#${route}`);
      await ready(page);
      await page
        .locator('.object-hero__actions')
        .getByRole('button', { name: /^Править/ })
        .click();
      const title = `Вымышленная правка ${name} ${percent}`;
      await page.locator('form input[type="text"], form input:not([type])').first().fill(title);
      await page.locator('form button[type="submit"]').click();
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.locator('.ui7-fullscreen-form')).toHaveCount(0);
    }
  });
}

test('UI-7: поля входа, быстрого добавления и формы дела — 48 px', async ({ page, family }) => {
  test.skip(before);
  await page.goto('#/sign-in');
  await expect(page.getByLabel('Имя пользователя или почта')).toBeVisible();
  const checkHeight = async (selector: string) => {
    const heights = await page
      .locator(selector)
      .evaluateAll((fields) => fields.map((f) => f.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height).toBe(48);
  };
  await checkHeight('.auth-field input, .password-field');
  await signInAs(page, family, 'adult');
  await page.goto('#/today/new');
  await ready(page);
  await checkHeight('form input:not([type="checkbox"]):not([type="radio"]), form select');
  await page.goto('#/today');
  await ready(page);
  await openQuick(page);
  await expect(page.getByLabel('Быстрая строка')).toBeVisible();
  await checkHeight('.task-quickline textarea');
  const quickline = page.getByLabel('Быстрая строка');
  await quickline.fill(
    'Заменить вымышленный картридж фильтра на кухне и проверить соединения после установки',
  );
  expect(await quickline.evaluate((input) => input.scrollHeight <= input.clientHeight)).toBe(true);
  await expectAccessible(page, 'quick-add');
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
});
