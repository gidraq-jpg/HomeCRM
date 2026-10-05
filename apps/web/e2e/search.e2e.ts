import { expect, test } from './support/fixtures.ts';
import { checkScreen, openApp, setScope } from './support/helpers.ts';

// Единый поиск — PRD, SRCH-1…4: словоформы, номера, значок доступа, копирование из результата.

const box = (page: import('@playwright/test').Page) =>
  page.getByRole('searchbox', { name: 'Что найти' });

test('поиск открывается из шапки, поле сразу в фокусе, пустой поиск объясняет, что ищет', async ({
  page,
}, testInfo) => {
  await openApp(page, '/today');
  await page.getByRole('link', { name: 'Поиск' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Поиск');
  await expect(box(page)).toBeFocused();
  await expect(page.getByText('Ищем в режиме «Всё».')).toBeVisible();
  await expect(page.getByText('Находит названия, номера счетов и документов')).toBeVisible();
  await checkScreen(page, testInfo, 'search-empty-state', { noShot: true });
});

test('понимает словоформы: «страховку дачи», «страхование дачи»', async ({ page }) => {
  await openApp(page, '/search');
  for (const query of ['страховку дачи', 'страхование дачи', 'СТРАХОВКА ДАЧИ']) {
    await box(page).fill(query);
    await expect(page.getByRole('link', { name: /Страховка дачи/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Страховка квартиры/ })).toHaveCount(0);
  }
});

test('результаты сгруппированы по типам, найдено — столько-то записей', async ({
  page,
}, testInfo) => {
  await openApp(page, '/search?q=дача');
  await expect(page.getByRole('heading', { level: 2, name: 'Дом' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Документы' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Найдено:' })).toBeVisible();
  await checkScreen(page, testInfo, 'search-results-grouped', { noShot: true });
});

test('номер лицевого счёта находится по части номера и копируется из результата', async ({
  page,
}) => {
  await openApp(page, '/search');
  await box(page).fill('4012-557');
  const result = page.getByRole('link', { name: /Содержание и ремонт \(ЕПД\), лицевой счёт/ });
  await expect(result).toContainText('№ 4012-557-0931');

  await page.getByRole('button', { name: 'Скопировать номер лицевого счёта' }).click();
  await expect(page.locator('.toast-region')).toContainText('Скопировано: номер лицевого счёта');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('4012-557-0931');

  await result.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Лицевые счета' })).toBeVisible();
});

test('ищет по телефону, заводскому номеру счётчика и тексту заметки', async ({ page }) => {
  await openApp(page, '/search');
  await box(page).fill('0123');
  await expect(page.getByRole('link', { name: /Пётр Семёнов/ })).toBeVisible();

  await box(page).fill('0412-8831');
  await expect(page.getByRole('link', { name: /Счётчик ХВС, кухня/ })).toBeVisible();

  await box(page).fill('плед');
  await expect(page.getByRole('link', { name: /Идеи подарков/ })).toBeVisible();
});

test('личные записи — со значком замка, а «Общее» их не показывает', async ({ page }) => {
  await openApp(page, '/search?q=паспорт');
  const passport = page.getByRole('link', { name: /Загранпаспорт/ });
  await expect(passport.getByRole('img', { name: 'Кто видит: Только я' })).toBeVisible();

  await setScope(page, 'Общее');
  await expect(passport).toHaveCount(0);
  await expect(page.getByText('Ничего не найдено')).toBeVisible();
  await expect(
    page.getByText('В режиме «Общее» совпадений нет, а во всех записях нашлось: 2.'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Искать во всём' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(passport).toBeVisible();
});

test('ничего не нашлось: подсказка без предложения сменить режим', async ({ page }) => {
  await openApp(page, '/search?q=инопланетянин');
  await expect(page.getByText('Попробуйте другое слово или часть номера.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Искать во всём' })).toHaveCount(0);
});

test('закрыть поиск возвращает на прежний экран', async ({ page }) => {
  await openApp(page, '/documents');
  await page.getByRole('link', { name: 'Поиск' }).click();
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Документы');
});

test('если открыли поиск по ссылке, «Закрыть поиск» ведёт на «Сегодня»', async ({ page }) => {
  await openApp(page, '/search?q=дача');
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сегодня');
});

test('запрос хранится в адресе: после перезагрузки поиск на месте', async ({ page }) => {
  await openApp(page, '/search');
  await box(page).fill('сантехник');
  await page.reload();
  await expect(box(page)).toHaveValue('сантехник');
  await expect(page.getByRole('link', { name: /Пётр Семёнов/ })).toBeVisible();
});
