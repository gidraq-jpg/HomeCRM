import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { expectNothingStored } from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Первый запуск и шаблоны (R1a.7b): TPL-1…4. Семья вымышленная: Анна — администратор, Борис —
// взрослый, Вера — ребёнок. Объекты создаются экранами, а результат проверяется в базе сценария.

const toast = (page: Page) => page.locator('.toast-region');
const form = (page: Page) => page.locator('form.template-form');
const group = (page: Page, name: string) => form(page).getByRole('group', { name, exact: true });

async function count(family: Family, sql: string) {
  const result = await family.database.admin.query<{ n: number }>(sql);
  return result.rows[0]?.n ?? -1;
}

async function openTemplateForm(page: Page, template: string) {
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить' });
  await dialog.getByRole('button', { name: /^Из шаблона/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Объект из шаблона', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: new RegExp(`^${template}`) }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Новый объект', exact: true }),
  ).toBeVisible();
}

test('первый запуск: мастер с пропуском шагов, прогресс в адресе и на сервере', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'admin');
  const card = page.getByRole('region', { name: 'Начните с первого объекта' });
  await expect(card).toBeVisible();
  await checkApp(page, info, 'start-today');

  // Шаг «Дом»: пояс; пропуск.
  await card.getByRole('link', { name: 'Настроить дом' }).click();
  await expect(page).toHaveURL(/#\/start\/house$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Шаг 1 из 4' })).toBeVisible();
  await checkApp(page, info, 'start-house');
  await page.getByRole('button', { name: 'Пропустить' }).click();

  // Шаг «Шаблон»: выбор; пропуск следующего шага не создаёт ничего.
  await expect(page.getByRole('heading', { level: 1, name: 'Шаблон', exact: true })).toBeVisible();
  await checkApp(page, info, 'start-template');
  await page.getByRole('link', { name: /^Сдаваемая квартира/ }).click();
  await expect(page).toHaveURL(/#\/start\/object\/rented_apartment$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Первый объект', exact: true }),
  ).toBeVisible();
  await form(page).getByLabel('Название объекта').fill('Квартира у парка');

  // Перезагрузка: шаг остался в адресе, введённое было только в памяти.
  await page.reload();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Первый объект', exact: true }),
  ).toBeVisible();
  await expect(form(page).getByLabel('Название объекта')).toHaveValue('');
  await expectNothingStored(page, ['Квартира у парка']);
  await form(page).getByRole('button', { name: 'Пропустить' }).click();

  // Шаг «Приглашения»: ссылка показывается один раз; потом «Готово».
  await expect(
    page.getByRole('heading', { level: 1, name: 'Приглашения', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Создать ссылку-приглашение' }).click();
  await expect(page.getByTestId('issued-link')).toBeVisible();
  await checkApp(page, info, 'start-invite');
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  // Объекта нет, пока шаг пропущен: карточка по-прежнему приглашает.
  await expect(card).toBeVisible();
  expect(await count(family, 'SELECT count(*)::int AS n FROM objects')).toBe(0);

  // Второй проход: объект создаётся, мастер дальше начинается с приглашений.
  await page.goto('#/start');
  await expect(page).toHaveURL(/#\/start\/house$/);
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await page.getByRole('link', { name: /^Квартира в многоквартирном доме/ }).click();
  await form(page).getByLabel('Название объекта').fill('Квартира у парка');
  await form(page).getByRole('button', { name: 'Создать объект' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Приглашения', exact: true }),
  ).toBeVisible();
  expect(await count(family, 'SELECT count(*)::int AS n FROM objects')).toBe(1);
  expect(await count(family, 'SELECT count(*)::int AS n FROM utility_accounts')).toBe(9);

  await page.goto('#/today');
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  await expect(card).toHaveCount(0);
  await page.goto('#/start');
  await expect(page).toHaveURL(/#\/start\/invite$/);
  await expectNothingStored(page, ['Квартира у парка']);
});

test('«Сдаваемая квартира» со снятыми галочками: одно действие, повтор не создаёт дубль', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');

  // Пустой «Дом» предлагает шаблон (TPL-4).
  await page.goto('#/home');
  const empty = page.getByRole('region', { name: 'Объектов пока нет' });
  await expect(empty.getByRole('link', { name: 'Создать из шаблона' })).toBeVisible();

  await openTemplateForm(page, 'Сдаваемая квартира');
  await expect(form(page).getByRole('checkbox')).toHaveCount(19);
  await group(page, 'Лицевые счета').getByRole('checkbox', { name: 'Газ', exact: true }).uncheck();
  await group(page, 'Счётчики').getByRole('checkbox', { name: 'ХВС', exact: true }).uncheck();
  await group(page, 'Налоговый режим').getByRole('radio', { name: /^НПД/ }).check();
  await form(page).getByLabel('Название объекта').fill('Квартира для аренды');
  await form(page).getByLabel('Адрес').fill('Вымышленная улица, 1');
  await form(page).getByLabel('Начальное показание: ГВС, м³').fill('123,456');

  // «Кто видит» над «Создать»; недвижимость — «Взрослые».
  const visibility = form(page).getByRole('group', { name: 'Кто видит' });
  await expect(visibility.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
  const box = await visibility.boundingBox();
  const submit = await form(page)
    .getByRole('button', { name: 'Создать', exact: true })
    .boundingBox();
  expect(box && submit && box.y < submit.y).toBe(true);
  await checkApp(page, info, 'template-form');

  // Первый ответ теряется уже после создания: повтор с тем же ключом вернёт тот же объект.
  let lost = false;
  await page.route('**/api/templates/*/apply', async (route) => {
    if (lost) return route.continue();
    lost = true;
    await route.fetch();
    return route.abort('failed');
  });
  await form(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('неизвестно, создался ли объект');
  await checkApp(page, info, 'template-form-retry');
  await form(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира для аренды', exact: true }),
  ).toBeVisible();
  await expect(toast(page)).toContainText('Объект создан из шаблона');

  expect(await count(family, 'SELECT count(*)::int AS n FROM objects')).toBe(1);
  // Девять счетов без газа, пять счётчиков без ХВС, обе организации.
  expect(await count(family, 'SELECT count(*)::int AS n FROM utility_accounts')).toBe(8);
  expect(await count(family, 'SELECT count(*)::int AS n FROM meters')).toBe(4);
  expect(await count(family, 'SELECT count(*)::int AS n FROM contacts')).toBe(2);
  expect(await count(family, 'SELECT count(*)::int AS n FROM meter_readings')).toBe(1);
  // Три срока шаблона и налоговый срок НПД.
  expect(
    await count(
      family,
      "SELECT count(*)::int AS n FROM deadlines WHERE source_kind = 'record' AND label IS NOT NULL",
    ),
  ).toBe(4);
  expect(
    await count(
      family,
      "SELECT count(*)::int AS n FROM objects WHERE type_data->>'address' = 'Вымышленная улица, 1'",
    ),
  ).toBe(1);

  await page.getByRole('link', { name: 'Счета', exact: true }).click();
  await expect(page.getByText('8 лицевых счетов')).toBeVisible();
  await expectNothingStored(page, ['Квартира для аренды', 'Вымышленная улица', '123,456']);
});

test('ребёнок создаёт из шаблона только личный объект; ошибка не оставляет следов', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'child');
  await openTemplateForm(page, 'Частный дом или дача');
  const visibility = form(page).getByRole('group', { name: 'Кто видит' });
  await expect(visibility.getByRole('radio')).toHaveCount(1);
  await expect(visibility.getByRole('radio', { name: 'Только я' })).toBeChecked();

  // Пустое название: ошибка у поля, ничего не создано.
  await form(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(form(page).getByRole('alert')).toContainText('Назовите объект');
  await expect(form(page).getByLabel('Название объекта')).toBeFocused();
  await checkApp(page, info, 'template-form-error');
  expect(await count(family, 'SELECT count(*)::int AS n FROM objects')).toBe(0);

  await form(page).getByLabel('Название объекта').fill('Дача у озера');
  await form(page).getByRole('button', { name: 'Создать', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Дача у озера', exact: true }),
  ).toBeVisible();
  expect(
    await count(family, "SELECT count(*)::int AS n FROM objects WHERE space_kind = 'personal'"),
  ).toBe(1);
  // Два срока дачи уходят в календарь дома, хотя объект личный.
  expect(
    await count(
      family,
      "SELECT count(*)::int AS n FROM deadlines WHERE source_kind = 'record' AND label IS NOT NULL",
    ),
  ).toBe(2);
});
