import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';
import { checkScreen, goToSection, openApp, setScope } from './support/helpers.ts';

// Переключатель «Всё · Общее · Личное», значки доступа и пустые состояния — PRD, раздел 7.4.

const link = (page: Page, name: RegExp | string) => page.getByRole('link', { name });
const personalBadge = (page: Page) => page.getByRole('img', { name: 'Кто видит: Только я' });

test('по умолчанию выбрано «Всё», выбор запоминается на устройстве', async ({ page }) => {
  await openApp(page, '/today');
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();

  await setScope(page, 'Личное');
  await goToSection(page, 'Документы');
  await expect(page.getByRole('radio', { name: 'Личное' })).toBeChecked();

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Личное' })).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('homecrm.scope'))).toBe('personal');

  await setScope(page, 'Всё');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
});

test('«Сегодня»: «Общее» скрывает личное, «Личное» скрывает общее', async ({ page }) => {
  await openApp(page, '/today');
  // «Всё»: личное и общее вместе, личное — с замком.
  await expect(page.getByText('Записаться к стоматологу')).toBeVisible();
  await expect(page.getByText('Забрать посылку на почте')).toBeVisible();
  await expect(page.getByText('Собрать документы на новый загранпаспорт')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Открыто окно показаний' })).toBeVisible();

  await setScope(page, 'Общее');
  await expect(page.getByText('Забрать посылку на почте')).toBeVisible();
  await expect(page.getByText('Позвонить в УК про течь в ванной')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Открыто окно показаний' })).toBeVisible();
  await expect(page.getByText('Записаться к стоматологу')).toHaveCount(0);
  await expect(page.getByText('Собрать документы на новый загранпаспорт')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Что сегодня важнее всего?' })).toBeVisible();
  await expect(personalBadge(page)).toHaveCount(0);

  await setScope(page, 'Личное');
  await expect(page.getByText('Записаться к стоматологу')).toBeVisible();
  await expect(page.getByText('Собрать документы на новый загранпаспорт')).toBeVisible();
  await expect(page.getByText('Забрать посылку на почте')).toHaveCount(0);
  await expect(page.getByText('Позвонить в УК про течь в ванной')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Открыто окно показаний' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Срочное' })).toHaveCount(0);
});

test('три значка доступа: замок, два человека, дом — на записях разных видов', async ({ page }) => {
  await openApp(page, '/today');
  const row = (text: string) => page.locator('.task-row').filter({ hasText: text });
  await expect(
    row('Записаться к стоматологу').getByRole('img', { name: 'Кто видит: Только я' }),
  ).toBeVisible();
  await expect(
    row('Позвонить в УК').getByRole('img', { name: 'Кто видит: Взрослые' }),
  ).toBeVisible();
  await expect(
    row('Забрать посылку').getByRole('img', { name: 'Кто видит: Вся семья' }),
  ).toBeVisible();
});

test('в карточке значок всегда с подписью и пояснением', async ({ page }) => {
  await openApp(page, '/documents/doc-intl-passport');
  const card = page.locator('.access-card');
  await expect(card.getByText('Только я', { exact: true })).toBeVisible();
  await expect(card).toContainText('Видите только вы');

  await openApp(page, '/home/sadovaya');
  await expect(page.locator('.access-card').getByText('Взрослые', { exact: true })).toBeVisible();
  await expect(page.locator('.property-meta').getByText('Взрослые', { exact: true })).toBeVisible();

  await openApp(page, '/people/plumber');
  await expect(page.locator('.access-card').getByText('Вся семья', { exact: true })).toBeVisible();
});

test.describe('режимы фильтруют все разделы', () => {
  test('«Документы»: 10 → «Общее» 7 → «Личное» 3', async ({ page }) => {
    await openApp(page, '/documents');
    const rows = page.getByRole('list', { name: 'Документы' }).getByRole('listitem');
    await expect(rows).toHaveCount(10);
    await setScope(page, 'Общее');
    await expect(rows).toHaveCount(7);
    await expect(page.getByRole('link', { name: /Загранпаспорт/ })).toHaveCount(0);
    await setScope(page, 'Личное');
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole('link', { name: /Страховка дачи/ })).toHaveCount(0);
    await expect(personalBadge(page)).toHaveCount(3);
  });

  test('«Люди»: участники дома и общие контакты — в «Общем», личные — в «Личном»', async ({
    page,
  }, testInfo) => {
    await openApp(page, '/people');
    await expect(page.getByRole('heading', { name: 'Участники дома' })).toBeVisible();
    await expect(page.getByText('Анна Орлова (вы)')).toBeVisible();
    await expect(link(page, /Марина Ветрова/)).toBeVisible();
    await expect(link(page, /Пётр Семёнов/)).toBeVisible();

    await setScope(page, 'Общее');
    await expect(page.getByRole('heading', { name: 'Участники дома' })).toBeVisible();
    await expect(link(page, /Пётр Семёнов/)).toBeVisible();
    await expect(link(page, /Марина Ветрова/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Личные контакты' })).toHaveCount(0);

    await setScope(page, 'Личное');
    await expect(page.getByRole('heading', { name: 'Участники дома' })).toHaveCount(0);
    await expect(link(page, /Марина Ветрова/)).toBeVisible();
    await expect(link(page, /Ирина Павловна/)).toBeVisible();
    await expect(link(page, /Пётр Семёнов/)).toHaveCount(0);
    await checkScreen(page, testInfo, 'people-personal-only');
  });

  test('«Заметки»: 4 → «Общее» 2 → «Личное» 2', async ({ page }) => {
    await openApp(page, '/more/notes');
    const rows = page.getByRole('list', { name: 'Заметки' }).getByRole('listitem');
    await expect(rows).toHaveCount(4);
    await setScope(page, 'Общее');
    await expect(rows).toHaveCount(2);
    await setScope(page, 'Личное');
    await expect(rows).toHaveCount(2);
    await expect(link(page, /Идеи подарков/)).toBeVisible();
  });

  test('«Радар»: личные пункты (загранпаспорт) только в «Всё» и «Личное»', async ({ page }) => {
    await openApp(page, '/more/radar');
    await expect(link(page, /Загранпаспорт/)).toBeVisible();
    await setScope(page, 'Общее');
    await expect(link(page, /Загранпаспорт/)).toHaveCount(0);
    await expect(link(page, /Страховка дачи/)).toBeVisible();
    await setScope(page, 'Личное');
    await expect(link(page, /Загранпаспорт/)).toBeVisible();
    await expect(link(page, /Страховка дачи/)).toHaveCount(0);
  });

  test('«Ещё»: счётчики на строках следуют за режимом', async ({ page }) => {
    await openApp(page, '/more');
    await expect(page.getByText('Сейчас видно: 4')).toBeVisible();
    await setScope(page, 'Личное');
    await expect(page.getByText('Сейчас видно: 2')).toBeVisible();
  });
});

test.describe('пустые состояния объясняют разницу личного и общего (TPL-4)', () => {
  test('«Дом» в режиме «Личное»: объяснение, первое действие и путь назад', async ({
    page,
  }, testInfo) => {
    await openApp(page, '/home');
    await setScope(page, 'Личное');

    const empty = page.getByRole('region', { name: 'Объектов пока нет' });
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('Здесь только ваши записи. Их не видит никто, кроме вас.');
    await expect(empty).toContainText('Квартира в многоквартирном доме');
    await expect(empty.getByRole('button', { name: 'Добавить объект' })).toBeVisible();
    await expect(empty.getByRole('link', { name: 'Как устроены личное и общее' })).toBeVisible();
    await checkScreen(page, testInfo, 'home-empty-personal');

    await empty.getByRole('button', { name: /Показать «Всё»/ }).click();
    await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
    await expect(link(page, /Квартира на Садовой/)).toBeVisible();
  });

  test('первое действие открывает форму нужного вида с личным доступом по умолчанию', async ({
    page,
  }) => {
    await openApp(page, '/home');
    await setScope(page, 'Личное');
    await page.getByRole('button', { name: 'Добавить объект' }).click();

    const dialog = page.getByRole('dialog', { name: 'Новый объект' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Только я' })).toBeChecked();
    await expect(dialog.getByLabel('Шаблон')).toBeVisible();
  });

  test('«Покупки» в режиме «Личное»: список пуст, предлагается первая покупка', async ({
    page,
  }) => {
    await openApp(page, '/more/shopping');
    await setScope(page, 'Личное');
    const empty = page.getByRole('region', { name: 'В списке пусто' });
    await expect(empty).toContainText('Здесь только ваши записи. Их не видит никто, кроме вас.');
    await expect(empty.getByRole('button', { name: 'Добавить покупку' })).toBeVisible();
  });

  test('«Покупки» в режиме «Общее»: только общий список, личного нет', async ({ page }) => {
    await openApp(page, '/more/shopping');
    await expect(page.getByRole('heading', { name: 'Общий список' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Мой список' })).toBeVisible();
    await setScope(page, 'Общее');
    await expect(page.getByRole('heading', { name: 'Общий список' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Мой список' })).toHaveCount(0);
  });

  test('«Корзина» объясняет, что личная корзина видна только владельцу', async ({ page }) => {
    await openApp(page, '/more/trash');
    await expect(page.getByText('Личная корзина — только ваша')).toBeVisible();
  });
});
