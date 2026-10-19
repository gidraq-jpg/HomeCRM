import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TaskCard } from '../../src/tasks/api.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openQuick,
  settle,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

const formatDateOnly = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${value}T12:00:00Z`),
  );

for (const zoom of [100, 200]) {
  test(`D12: правка четырёх чипов, сброс, снятие и сохранение · ${zoom}%`, async ({
    page,
    family,
  }, info) => {
    test.setTimeout(120_000);
    await setHomeZone(family);
    const api = await apiAs(family, 'adult');
    const first = await seedProperty(api, family, { title: 'Учебная', audience: 'household' });
    const second = await seedProperty(api, family, {
      title: 'Квартира с длинным названием у учебного парка',
      audience: 'household',
    });
    await seedMeter(api, first.id, {
      title: 'Холодная вода',
      data: { resource: 'cold_water', serialNumber: 'TEST-D12-1' },
      initial: { occurredOn: homeDate(0), values: ['1245.300'] },
    });
    await signInAs(page, family, 'adult');
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value}%`;
    }, zoom);
    await openQuick(page);
    const input = page.getByLabel('Быстрая строка');
    const raw = 'Позвонить завтра в 18:00 #Учебная @Борис';
    await input.fill(raw);
    await expect(page.locator('.task-chip')).toHaveCount(4);
    const directory = resolve(import.meta.dirname, '../../test-results/screens/UI-4b');
    async function check(name: string) {
      await page.evaluate(() => document.fonts.ready);
      await settle(page);
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
      await expectAccessible(page, `D12 · ${name} · ${zoom}%`);
      if (process.platform === 'linux') {
        await mkdir(directory, { recursive: true });
        await page.screenshot({
          path: resolve(directory, `${info.project.name}-${zoom}-${name}.png`),
        });
      }
    }
    await check('chips');
    async function edit(kind: string, field: string, value: string, select = false) {
      await page.getByRole('button', { name: new RegExp(`^Изменить ${kind}:`) }).click();
      const dialog = page.getByRole('dialog', { name: `Править чип: ${field}`, exact: true });
      await expect(dialog).toBeVisible();
      if (select) await dialog.getByLabel(field, { exact: true }).selectOption(value);
      else await dialog.getByLabel(field, { exact: true }).fill(value);
      await check(`edit-${field}`);
      await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    await edit('дату', 'Дата', homeDate(3));
    // Новая строка сбрасывает прежние overrides, но сохраняет исходный разбор.
    await input.fill(`${raw} ещё`);
    await expect(
      page.getByRole('button', {
        name: `Изменить дату: ${formatDateOnly(homeDate(1))}`,
        exact: true,
      }),
    ).toBeVisible();
    await input.fill(raw);
    await edit('дату', 'Дата', homeDate(3));
    await edit('время', 'Время', '09:45');
    await edit('исполнителя', 'Исполнитель', family.person('admin').id, true);
    await edit('объект', 'Объект', second.id, true);
    for (const value of [formatDateOnly(homeDate(3)), '09:45', 'Анна', second.title])
      await expect(page.locator('.quickline-result')).toContainText(value);
    await expect(
      page.getByRole('button', {
        name: `Изменить дату: ${formatDateOnly(homeDate(3))}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Изменить время: 09:45', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Изменить исполнителя: Анна', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Изменить объект: ${second.title}`, exact: true }),
    ).toBeVisible();
    await check('edited');
    await page.getByRole('button', { name: 'Убрать время: 09:45', exact: true }).click();
    await expect(page.locator('.task-chip')).toHaveCount(3);
    await expect(page.locator('.quickline-result')).toContainText('Позвонить в 18:00');
    await expect(page.locator('.quickline-result')).not.toContainText('09:45');
    await check('removed');
    // Восстанавливаем чип новой строкой; после этого сохраняем все четыре исправления.
    await input.fill(`${raw} ещё`);
    await input.fill(raw);
    await edit('дату', 'Дата', homeDate(3));
    await edit('время', 'Время', '09:45');
    await edit('исполнителя', 'Исполнитель', family.person('admin').id, true);
    await edit('объект', 'Объект', second.id, true);
    await page.getByRole('button', { name: 'Добавить дело', exact: true }).click();
    await expect(page).toHaveURL(/tasks\/[a-f0-9-]+$/);
    const taskId = page.url().split('/').at(-1);
    const saved = TaskCard.parse((await api.get(`tasks/${taskId}`)).body);
    expect(saved).toMatchObject({
      title: 'Позвонить',
      planOn: homeDate(3),
      planTime: '09:45',
      assigneeId: family.person('admin').id,
      spaceId: family.houseId,
    });
    const links = (await api.get(`records/task/${taskId}/links`)).body as {
      left: { id: string };
      right: { id: string };
    }[];
    expect(links.some((link) => [link.left.id, link.right.id].includes(second.id))).toBe(true);
    expect(links.some((link) => [link.left.id, link.right.id].includes(first.id))).toBe(false);
    await page.goto(`#/home/${first.id}`);
    await expect(page.getByRole('list', { name: 'Счётчики объекта' })).toContainText(/1\s245,3 м³/);
    await check('reading');
    const main = await api.post('tasks', {
      title: first.title,
      planOn: homeDate(0),
      objectId: first.id,
      placement: { spaceId: family.houseId, audience: 'household' },
    });
    expect(main.status).toBe(201);
    const mainId = TaskCard.parse(main.body).id;
    expect(await api.post(`tasks/${mainId}/main`, { selected: true })).toMatchObject({
      status: 200,
    });
    const mainLinks = page.waitForResponse(
      (response) => response.url().includes(`/api/records/task/${mainId}/links`) && response.ok(),
    );
    await page.goto('#/today');
    await mainLinks;
    await settle(page);
    await expect(page.locator('.task-focus .focus__title')).toHaveText(first.title);
    await expect(page.locator('.task-focus .focus__access')).not.toContainText(first.title);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const add = page.getByRole('dialog', { name: 'Добавить', exact: true });
    await expect(add.getByRole('button', { name: /^Дело/ })).toContainText('Одной строкой');
    await add.getByRole('button', { name: /^Дело/ }).click();
    await page
      .getByRole('dialog', { name: 'Новое дело', exact: true })
      .getByRole('link', { name: 'Полная форма дела', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Новое дело', exact: true }),
    ).toBeVisible();
  });
}
