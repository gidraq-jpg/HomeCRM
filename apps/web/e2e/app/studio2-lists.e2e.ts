import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, openRadar, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { signInAs } from './support.ts';

async function check(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, name);
  if (await page.locator('.today-tabs').count()) {
    await page.locator('.today-tabs').scrollIntoViewIfNeeded();
    await expect(page.locator('.today-tabs [aria-current="page"]')).toBeInViewport({ ratio: 0.95 });
    await expect(page.locator('.today-tabs .studio-add')).toBeInViewport({ ratio: 0.95 });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  if (process.platform === 'linux') {
    const dir = resolve(import.meta.dirname, '../../test-results/screens/UI-5');
    await mkdir(dir, { recursive: true });
    await page.screenshot({
      path: resolve(dir, `${name}-${info.project.name}.png`),
      fullPage: false,
    });
  }
}
async function scale(page: Page, value: number) {
  await page.evaluate((percent) => {
    document.documentElement.style.fontSize = `${percent}%`;
  }, value);
}
async function open(page: Page, route: string) {
  await page.goto(`#${route}`);
  await expect(page.locator('.studio-list-panel')).toBeVisible();
  await expect(page.getByText(/Загружаем (заметки|дела|покупки|радар)…/)).toHaveCount(0);
}

for (const percent of [100, 200]) {
  test(`UI-5: все дела, группы и фильтры; текст ${percent}%`, async ({ page, family }, info) => {
    await setHomeZone(family, 'Pacific/Kiritimati');
    const api = await apiAs(family, 'adult');
    const date = (days: number) => homeDate(days, 'Pacific/Kiritimati');
    for (const fields of [
      { title: 'Проверить вымышленный фильтр', planOn: date(-1) },
      { title: 'Полить вымышленные цветы', planOn: date(0) },
      { title: 'Заказать вымышленную деталь', planOn: date(20) },
      { title: 'Разобрать вымышленный ящик' },
    ])
      expect((await api.post('tasks', fields)).status).toBe(201);
    await signInAs(page, family, 'adult');
    await scale(page, percent);
    await open(page, '/today/all');
    await expect(page.getByRole('heading', { name: 'Просрочено', exact: true })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Просрочено', exact: true })).toContainText(
      'Проверить вымышленный фильтр',
    );
    await check(page, info, `all-tasks-${percent}`);
    await page.getByRole('button', { name: 'Без даты', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Без даты', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByRole('link', { name: 'Разобрать вымышленный ящик', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Полить вымышленные цветы', exact: true }),
    ).toHaveCount(0);
    await check(page, info, `all-filter-${percent}`);
    await page.getByRole('button', { name: 'Без даты', exact: true }).click();
    await page.getByRole('button', { name: 'Объект ▾', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Фильтр по объекту' })).toBeVisible();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.getByRole('link', { name: '1 просрочено', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Полить вымышленные цветы', exact: true }),
    ).toHaveCount(0);
  });

  test(`UI-5: радар, режим, действие и меню; текст ${percent}%`, async ({ page, family }, info) => {
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    for (const [title, days] of [
      ['Проверить вымышленную страховку', -1],
      ['Вымышленный паспорт', 20],
    ] as const) {
      const note = await seedNote(api, family, { title, audience: 'household' });
      await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(days) });
    }
    await recalc(family);
    await signInAs(page, family, 'adult');
    await scale(page, percent);
    await page.getByRole('link', { name: 'Весь радар', exact: true }).click();
    await expect(
      page
        .getByRole('navigation', { name: 'Основные разделы' })
        .getByRole('link', { name: 'Сегодня', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Сегодня', exact: true }).first().click();
    await openRadar(page);
    await page.getByRole('button', { name: 'Весь дом', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Весь дом', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('list', { name: 'Просрочено', exact: true })).toContainText(
      'Проверить вымышленную страховку',
    );
    await check(page, info, `radar-${percent}`);
    const fold = page.locator('.studio-radar-fold').filter({ hasText: '30 дней' });
    await expect(fold).not.toHaveAttribute('open');
    await fold.locator('summary').click();
    await expect(page.getByRole('list', { name: '30 дней', exact: true })).toBeVisible();
    await check(page, info, `radar-expanded-${percent}`);
    await page
      .getByRole('button', { name: 'Ещё действия: Проверить вымышленную страховку', exact: true })
      .click();
    await page.getByRole('button', { name: 'Не актуально', exact: true }).click();
    await page.getByLabel('Причина', { exact: true }).fill('Вымышленный срок отменён');
    await check(page, info, `radar-menu-${percent}`);
    await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Просрочено', exact: true })).toHaveCount(0);
    await fold.getByRole('button', { name: /^Ещё действия:/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'В работу', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Вымышленный паспорт', exact: true }),
    ).toBeVisible();
  });

  test(`UI-5: покупки, четыре вкладки, Enter, отмена и офлайн; текст ${percent}%`, async ({
    page,
    family,
  }, info) => {
    const api = await apiAs(family, 'adult');
    expect(
      (
        await api.post('shopping', {
          title: 'Вымышленные яблоки',
          quantity: '2 кг',
          data: { category: 'Продукты', note: 'Для вымышленного пирога' },
          placement: { spaceId: family.houseId, audience: 'household' },
        })
      ).status,
    ).toBe(201);
    await signInAs(page, family, 'adult');
    await scale(page, percent);
    await page
      .getByRole('navigation', { name: 'Ленты дел' })
      .getByRole('link', { name: 'Покупки', exact: true })
      .click();
    await expect(
      page
        .getByRole('navigation', { name: 'Основные разделы' })
        .getByRole('link', { name: 'Сегодня', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: /Вымышленные яблоки/ })).toBeVisible();
    await page.getByRole('button', { name: 'Добавить покупку', exact: true }).click();
    const input = page.getByLabel('Добавить одной строкой', { exact: true });
    await expect(input).toBeFocused();
    await check(page, info, `shopping-${percent}`);
    await input.fill('Вымышленный хлеб');
    await input.press('Enter');
    await expect(page.getByRole('link', { name: 'Вымышленный хлеб', exact: true })).toBeVisible();
    await page.getByRole('checkbox', { name: 'Вымышленный хлеб', exact: true }).click();
    await expect(page.locator('.shopping-bought > summary')).toBeVisible();
    await page.locator('.shopping-bought > summary').click();
    await expect(page.locator('.shopping-bought')).toContainText('Вымышленный хлеб');
    await check(page, info, `shopping-bought-${percent}`);
    await page.getByRole('checkbox', { name: 'Вымышленный хлеб', exact: true }).click();
    await expect(page.locator('.shopping-bought')).toHaveCount(0);
    await page
      .getByRole('navigation', { name: 'Ленты дел' })
      .getByRole('link', { name: 'Сегодня', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Сегодня', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.context().setOffline(true);
    await page
      .getByRole('navigation', { name: 'Ленты дел' })
      .getByRole('link', { name: 'Покупки', exact: true })
      .click();
    await expect(page.getByRole('link', { name: /Вымышленные яблоки/ })).toBeVisible();
    await expect(page.getByText('Без сети покупки доступны только для чтения.')).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Вымышленный хлеб', exact: true }),
    ).toBeDisabled();
    await check(page, info, `shopping-offline-${percent}`);
    const context = page.context();
    await page.close();
    await context.setOffline(false);
  });

  test(`UI-5: заметки с закреплёнными и без них; текст ${percent}%`, async ({
    page,
    family,
  }, info) => {
    const api = await apiAs(family, 'adult');
    const pinned = await seedNote(api, family, {
      title: 'Вымышленный список на дачу',
      pinned: true,
      audience: 'household',
      checklist: [{ title: 'Вымышленные перчатки', done: true }],
    });
    const personalPinned = await seedNote(api, family, {
      title: 'Вымышленный пароль Wi-Fi',
      pinned: true,
    });
    await seedNote(api, family, { title: 'Вымышленные размеры окна' });
    await signInAs(page, family, 'adult');
    await scale(page, percent);
    await open(page, '/more/notes');
    await expect(page.locator('.notes-pinned__card')).toHaveCount(2);
    await check(page, info, `notes-${percent}`);
    await page.getByLabel('Найти по заголовку').fill('размеры');
    await expect(page.getByRole('heading', { name: 'Закреплённые', exact: true })).toHaveCount(0);
    await check(page, info, `notes-unpinned-${percent}`);
    expect((await api.patch(`notes/${pinned.id}`, { pinned: false })).status).toBe(200);
    expect((await api.patch(`notes/${personalPinned.id}`, { pinned: false })).status).toBe(200);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Закреплённые', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Недавние', exact: true })).toBeVisible();
  });

  test(`UI-5: четыре пустых экрана; текст ${percent}%`, async ({ page, family }, info) => {
    await signInAs(page, family, 'adult');
    await scale(page, percent);
    for (const [route, name, empty] of [
      ['/today/all', 'all-empty', 'Дел под выбранные условия нет.'],
      ['/more/radar', 'radar-empty', 'Сроков пока нет'],
      ['/more/shopping', 'shopping-empty', 'Добавьте первую покупку'],
      ['/more/notes', 'notes-empty', 'Заметок пока нет'],
    ]) {
      await open(page, route ?? '');
      await expect(page.getByText(empty ?? '', { exact: true })).toBeVisible();
      await check(page, info, `${name}-${percent}`);
    }
  });
}

test('UI-5: ребёнок видит только доступное и добавляет общую покупку', async ({
  page,
  family,
}, info) => {
  const adult = await apiAs(family, 'adult');
  const child = await apiAs(family, 'child');
  const shared = await seedNote(adult, family, {
    title: 'Вымышленное общее',
    audience: 'household',
  });
  const adults = await seedNote(adult, family, {
    title: 'Вымышленное взрослое',
    audience: 'adults',
  });
  const personal = await seedNote(adult, family, { title: 'Вымышленное чужое личное' });
  for (const note of [shared, adults, personal])
    await seedDeadline(adult, 'notes', note.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'child');
  await openRadar(page);
  await page.getByRole('button', { name: 'Весь дом', exact: true }).click();
  await expect(page.getByRole('link', { name: /Вымышленное общее/ })).toBeVisible();
  await expect(page.getByText('Вымышленное взрослое', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Вымышленное чужое личное', { exact: true })).toHaveCount(0);
  await check(page, info, 'radar-child');
  await open(page, '/more/notes');
  await expect(page.getByText('Вымышленное взрослое', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Вымышленное чужое личное', { exact: true })).toHaveCount(0);
  await open(page, '/more/shopping');
  await page.getByLabel('Добавить одной строкой').fill('Вымышленный детский хлеб');
  await page.getByLabel('Добавить одной строкой').press('Enter');
  await expect(
    page.getByRole('link', { name: 'Вымышленный детский хлеб', exact: true }),
  ).toBeVisible();
  expect((await child.get(`notes/${personal.id}`)).status).toBe(404);
  expect((await child.get(`notes/${adults.id}`)).status).toBe(404);
  expect(
    JSON.stringify((await adult.get(`shopping?scope=household&spaceId=${family.houseId}`)).body),
  ).toContain('Вымышленный детский хлеб');
});
