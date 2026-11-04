import { TaskCard } from '../../src/tasks/api.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  settle,
} from '../support/helpers.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs, seedObject } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

test('Принятые карточки: реальные данные, операции и адаптивность', async ({
  page,
  family,
}, info) => {
  test.skip(info.project.name !== 'w360', 'Матрица выполняется один раз.');
  test.setTimeout(300_000);
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, {
    title: 'Квартира Солнечных',
    audience: 'household',
  });
  await seedMeter(api, property.id, {
    title: 'Холодная вода',
    data: { resource: 'cold_water', serialNumber: 'TEST-WATER' },
    initial: { occurredOn: '2026-07-20', values: ['124.600'] },
  });
  const object = await seedObject(api, family, { title: 'Фильтр воды' });
  const response = await api.post('tasks', {
    title: 'Проверить фильтр воды',
    description: 'Осмотреть соединения под мойкой.',
    dueOn: '2027-01-08',
    checklist: [
      { id: crypto.randomUUID(), title: 'Проверить напор воды', done: false, position: 0 },
    ],
  });
  expect(response.status).toBe(201);
  const task = TaskCard.parse(response.body);
  const openResponse = await api.post('tasks', {
    title: 'Осмотреть соединения фильтра',
    description: 'Проверить состояние картриджа и напор воды.',
    dueOn: '2027-01-08',
    checklist: [{ id: crypto.randomUUID(), title: 'Проверить картридж', done: false, position: 0 }],
  });
  expect(openResponse.status).toBe(201);
  const openTask = TaskCard.parse(openResponse.body);
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${task.id}`);
  await expect(page.getByRole('heading', { level: 1, name: task.title })).toBeVisible();
  await expect(page.locator('.approved-card-facts')).toContainText('8 янв.');
  await expect(page.getByRole('button', { name: 'Добавить дело', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Проверить напор воды' }).click();
  await expect(page.getByRole('checkbox', { name: 'Проверить напор воды' })).toBeChecked();
  await page.getByRole('button', { name: 'Выполнить', exact: true }).click();
  await expect(page.locator('.object-hero__meta')).toContainText('Выполнено');
  const linksPattern = /\/api\/records\/task\/[^/]+\/links/;
  const historyPattern = /\/api\/tasks\/[^/]+\/history/;
  await page.route(linksPattern, (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.route(historyPattern, (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto(`#/today/tasks/${openTask.id}`);
  await expect(page.getByRole('button', { name: 'Обновить связи', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Обновить историю', exact: true })).toBeVisible();
  await page.unroute(linksPattern);
  await page.unroute(historyPattern);
  await page.getByRole('button', { name: 'Обновить связи', exact: true }).click();
  await page.getByRole('button', { name: 'Обновить историю', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Обновить связи', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Обновить историю', exact: true })).toHaveCount(0);
  const routes = [
    ['task-open', `/today/tasks/${openTask.id}`],
    ['property', `/home/${property.id}`],
    ['object', `/home/${object.id}`],
    ['task-done', `/today/tasks/${task.id}`],
  ] as const;
  for (const width of [360, 412, 1280]) {
    await page.setViewportSize({ width, height: 915 });
    for (const percent of [100, 200]) {
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = `${size}%`;
      }, percent);
      for (const [name, route] of routes) {
        await page.goto(`#${route}`);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (name === 'property') {
          await expect(page.getByRole('list', { name: 'Счётчики объекта' })).toContainText(
            'Холодная вода',
          );
          await page.getByRole('list', { name: 'Счётчики объекта' }).getByRole('link').hover();
        }
        await expect(page.getByRole('status', { name: /^Загружаем/ })).toHaveCount(0);
        await settle(page);
        await expect(page.locator('.object-hero .studio-add')).toHaveCount(0);
        await expectAccessible(page, 'Принятая карточка');
        await expectNoHorizontalScroll(page);
        await expectTouchTargets(page);
        await page.screenshot({
          path: info.outputPath(`${name}-${width}-${percent}.png`),
          fullPage: true,
        });
      }
    }
  }
});
