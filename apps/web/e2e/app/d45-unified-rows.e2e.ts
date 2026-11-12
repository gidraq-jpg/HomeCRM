import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { signInAs } from './support.ts';

// UI-9 (D45): одна строка дела и покупки во всех вкладках. Фаза снимков — D45_PHASE=before|after.
async function capture(page: Page, info: TestInfo, tab: string) {
  if (process.platform !== 'linux') return;
  const directory = resolve(import.meta.dirname, '../../test-results/d45');
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(directory, `${process.env.D45_PHASE ?? 'after'}-${tab}-${info.project.name}.png`),
    fullPage: true,
  });
}

async function check(page: Page, info: TestInfo, tab: string) {
  await settle(page);
  // Снимки «до» только фиксируют прежний вид: проверки относятся к новой строке.
  if (process.env.D45_PHASE === 'before') return capture(page, info, tab);
  await expectAccessible(page, `d45-${tab}`);
  await expectNoHorizontalScroll(page);
  // Цели нажатия — в строках; показатели в шапке «Сегодня» вне этого правила.
  await expectTouchTargets(page, ':is(.plan-rows, .task-list)');
  await capture(page, info, tab);
}

test('UI-9: одинаковые строки дел и покупок на «Сегодня», «План», «Все дела», «Покупки»', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const house = { spaceId: family.houseId, audience: 'household' };
  const adults = { spaceId: family.houseId, audience: 'adults' };
  for (const task of [
    { title: 'Заменить вымышленный фильтр', planOn: homeDate(0), planTime: '18:00' },
    { title: 'Оплатить вымышленный интернет', planOn: homeDate(-3), dueOn: homeDate(-3) },
    { title: 'Обновить страховку вымышленного дома', planOn: homeDate(0), placement: adults },
    {
      title: 'Полить цветы',
      planOn: homeDate(0),
      planTime: '09:00',
      repeatRule: { kind: 'daily' },
    },
    {
      title: 'Купить вымышленные лампочки',
      planOn: homeDate(0),
      assigneeId: family.person('admin').id,
    },
    { title: 'Позвонить вымышленному мастеру по ремонту крыши и водостоков', planOn: homeDate(1) },
    { title: 'Разобрать вымышленный чердак', planOn: homeDate(3), planTime: '11:30' },
    {
      title: 'Дождаться вымышленной справки',
      planOn: homeDate(0),
      status: 'waiting',
      checkOn: homeDate(2),
      waitingAccountId: family.person('admin').id,
    },
    { title: 'Закрыть вымышленный счёт', planOn: homeDate(0) },
  ] as const) {
    const created = await api.post('tasks', { placement: house, ...task });
    expect(created.status).toBe(201);
  }
  for (const item of [
    {
      title: 'Молоко',
      quantity: '2 л',
      data: { store: 'Вымышленный магазин', category: 'Молочное' },
    },
    { title: 'Хлеб бородинский', data: { store: 'Вымышленный магазин', category: 'Молочное' } },
    { title: 'Яйца', quantity: '10', data: { note: 'крупные' } },
    { title: 'Подарочная бумага', quantity: '3 шт.', placement: adults, data: {} },
    { title: 'Мыло', quantity: '1', data: { note: 'жидкое', store: 'Хозяйственный' } },
  ]) {
    const created = await api.post('shopping', {
      placement: house,
      ...item,
    });
    expect(created.status).toBe(201);
  }
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('link', { name: 'Закрыть вымышленный счёт' })).toBeVisible();
  await page
    .getByRole('list', { name: 'Дела на сегодня', exact: true })
    .getByRole('button', { name: 'Выполнить', exact: true })
    .last()
    .click();
  await expect(page.getByText('Выполнено сегодня (1)', { exact: true })).toBeVisible();
  await page.getByText('Выполнено сегодня (1)', { exact: true }).click();
  await check(page, info, 'today');

  // Единая сетка «Сегодня»: круг 22 px в зоне 44 px, название 15 px, мета 13 px.
  if (process.env.D45_PHASE !== 'before') {
    const row = page.locator('.plan-row').first();
    const geometry = await row.evaluate((element) => {
      const size = (selector: string) => {
        const target = element.querySelector(selector);
        return target ? getComputedStyle(target).fontSize : null;
      };
      return {
        height: element.getBoundingClientRect().height,
        title: size('.plan-row__title'),
        meta: size('.plan-row__meta'),
        circle: element.querySelector('.plan-circle')?.getBoundingClientRect().width,
        zone: element.querySelector('.plan-row__done')?.getBoundingClientRect().width,
        icons: element.querySelectorAll('.row__icon, .access-badge').length,
      };
    });
    expect(geometry.height).toBeGreaterThanOrEqual(56);
    expect(geometry.title).toBe('15px');
    expect(geometry.meta).toBe('13px');
    expect(geometry.circle).toBe(22);
    expect(geometry.zone).toBeGreaterThanOrEqual(44);
    expect(geometry.icons).toBe(0);
    const today = page.getByRole('list', { name: 'Дела на сегодня', exact: true });
    await expect(today).not.toContainText('Открыто');
    await expect(today).toContainText('на 3 дня позже срока');
    await expect(today).toContainText('↻');
    await expect(today).toContainText('Взрослые');
    await expect(today).toContainText('→ ');
    await expect(today.locator('.plan-row__done').first()).toBeVisible();
  }

  await page.goto('#/today/plan');
  await expect(page.getByRole('link', { name: /Разобрать вымышленный чердак/ })).toBeVisible();
  await check(page, info, 'plan');

  await page.goto('#/today/all');
  await expect(page.getByRole('link', { name: /Разобрать вымышленный чердак/ })).toBeVisible();
  await check(page, info, 'all');

  await page.goto('#/more/shopping');
  await expect(page.getByRole('link', { name: /^Молоко/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Мыло' }).click();
  await expect(page.locator('.shopping-bought > summary')).toContainText('Куплено · 1');
  await page.locator('.shopping-bought > summary').click();
  await check(page, info, 'shopping');

  if (process.env.D45_PHASE !== 'before') {
    await page.getByRole('button', { name: /^Количество 2 л, изменить: Молоко$/ }).click();
    const steps = page.locator('.shopping-steps button');
    await expect(steps).toHaveCount(2);
    for (const button of await steps.all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    const box = await page.locator('.shopping-steps').boundingBox();
    const viewport = page.viewportSize();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
    await check(page, info, 'shopping-steps');
    // Заголовок строки добавления виден под липкими вкладками после «+» в нижней панели.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const label = page.getByText('Добавить одной строкой', { exact: true });
    await label.scrollIntoViewIfNeeded();
    const quick = page.locator('.shopping-quick');
    await quick.evaluate((element) => element.scrollIntoView({ block: 'start' }));
    const tabs = await page.locator('.today-tabs, .tabs').first().boundingBox();
    const heading = await label.boundingBox();
    expect(heading?.y ?? 0).toBeGreaterThanOrEqual((tabs?.y ?? 0) + (tabs?.height ?? 0));
  }
});
