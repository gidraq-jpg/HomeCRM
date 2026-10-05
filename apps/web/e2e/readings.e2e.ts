import { expect, test } from './support/fixtures.ts';
import { checkScreen, goToSection, openApp } from './support/helpers.ts';

// Экран «Показания» — PRD, S3 и UTIL-5…8: ввод на цифровой клавиатуре, проверки, передача.

const field = (page: import('@playwright/test').Page, meter: RegExp | string) =>
  page
    .locator('.reading')
    .filter({ has: page.getByRole('heading', { name: meter }) })
    .getByRole('textbox', { name: /Новое значение/ });

test('ввод: цифровая клавиатура, расход, ошибка «меньше прошлого», предупреждение об аномалии', async ({
  page,
}, testInfo) => {
  await openApp(page, '/home/sadovaya/readings');

  // Поле открывает цифровую клавиатуру и принимает запятую и точку.
  const kitchen = field(page, 'ХВС · Кухня');
  await expect(kitchen).toHaveAttribute('inputmode', 'decimal');
  await kitchen.fill('150,3');
  await expect(page.getByText('Расход: 2,788 м³')).toBeVisible();

  // Меньше прошлого — не принимается, ошибка у поля.
  const bath = field(page, 'ХВС · Ванная');
  await bath.fill('98.1');
  await expect(page.getByText('Меньше прошлого значения (98,240)')).toBeVisible();
  await expect(bath).toHaveAttribute('aria-invalid', 'true');

  // Расход на 40% выше обычного — предупреждение, но не запрет.
  const hot = field(page, 'ГВС · Кухня');
  await hot.fill('90');
  await expect(page.getByText('Расход: 7,894 м³')).toBeVisible();
  await expect(
    page.getByText('Расход выше обычного. Проверьте, нет ли утечки или ошибки.'),
  ).toBeVisible();
  await expect(hot).toHaveAttribute('aria-invalid', 'false');

  await checkScreen(page, testInfo, 'readings-filled');

  // «Сохранить всё» с ошибкой не сохраняет и возвращает фокус к неверному полю.
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.getByRole('alert')).toContainText('Исправьте значения');
  await expect(bath).toBeFocused();
});

test('пустая форма: нужно ввести хотя бы одно показание', async ({ page }) => {
  await openApp(page, '/home/sadovaya/readings');
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.getByRole('alert')).toContainText('Введите хотя бы одно показание');
});

test('сохранить всё → скопировать → отметить переданными: окно закрывается везде', async ({
  page,
}, testInfo) => {
  await openApp(page, '/today');
  await page
    .getByRole('article')
    .filter({ hasText: 'Квартира на Садовой' })
    .getByRole('link', { name: /Внести показания/ })
    .click();

  await field(page, 'ХВС · Кухня').fill('150,3');
  await field(page, 'ХВС · Ванная').fill('99');
  await field(page, 'ГВС · Кухня').fill('83,5');
  await field(page, 'ГВС · Ванная').fill('63');
  await field(page, 'Электроэнергия').fill('15 000');
  await page.getByRole('button', { name: 'Сохранить всё' }).click();

  const summary = page.locator('.transfer');
  await expect(summary.getByRole('heading', { name: 'Показания сохранены' })).toBeVisible();
  await expect(summary).toContainText('150,300 м³');
  await checkScreen(page, testInfo, 'readings-saved');

  await summary.getByRole('button', { name: 'Скопировать значения' }).click();
  await expect(page.getByRole('status')).toContainText('Значения скопированы');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('Водоснабжение и водоотведение, лицевой счёт 310-8842-17');
  expect(copied).toContain('ХВС, кухня: 150,300');
  expect(copied).toContain('Электроэнергия, лицевой счёт 70-25-4418');
  expect(copied).toContain('Электроэнергия, щиток в коридоре: 15000');

  await summary.getByRole('button', { name: 'Отметить переданными' }).click();
  await expect(summary.getByRole('heading', { name: 'Показания переданы' })).toBeVisible();

  // «Сегодня»: окно квартиры, где живёт семья, закрыто; окно сдаваемой квартиры — на месте.
  await goToSection(page, 'Сегодня');
  await expect(page.getByRole('article').filter({ hasText: 'Квартира на Садовой' })).toHaveCount(0);
  await expect(page.getByRole('article').filter({ hasText: 'Квартира на Речной' })).toBeVisible();

  // Радар и «Коммуналка за месяц» согласны.
  await page.goto('#/more/radar');
  await expect(
    page.getByRole('link', { name: /Окно показаний: вода и электроэнергия/ }),
  ).toHaveCount(0);
  await page.goto('#/home/month');
  await expect(page.getByText('Показания переданы', { exact: true })).toBeVisible();
});

test('значения можно изменить до передачи', async ({ page }) => {
  await openApp(page, '/home/sadovaya/readings');
  await field(page, 'ХВС · Кухня').fill('150,3');
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await page.getByRole('button', { name: 'Изменить значения' }).click();
  await expect(field(page, 'ХВС · Кухня')).toHaveValue('150,3');
  await field(page, 'ХВС · Кухня').fill('151');
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.locator('.transfer')).toContainText('151,000 м³');
});

test('сдаваемая квартира: свои счётчики и свой срок', async ({ page }) => {
  await openApp(page, '/home/rechnaya/readings');
  await expect(page.getByRole('heading', { level: 2, name: /^(ХВС|ГВС) · Ванная$/ })).toHaveCount(
    2,
  );
  await expect(page.getByRole('heading', { level: 2, name: /Электроэнергия/ })).toHaveCount(0);
});
