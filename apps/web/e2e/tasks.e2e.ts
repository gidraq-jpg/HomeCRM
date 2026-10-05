import { expect, test } from './support/fixtures.ts';
import {
  checkScreen,
  expectNoHorizontalScroll,
  goToSection,
  openApp,
  setScope,
  startAdd,
} from './support/helpers.ts';

// Пять заданий проверки из docs/stage0/navigation-test.md — как сквозные сценарии.
// Каждое задание выполняется и «главным» путём, и запасным: так видно, что прототип позволяет
// найти нужное по-разному. Тексты берутся из интерфейса так, как их видит участник.

const h1 = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1 });

test.describe('Задание 1. До какого числа передать показания воды в квартире, где живёт семья', () => {
  test('с экрана «Сегодня»: окно до 25 окт., затем экран ввода', async ({ page }, testInfo) => {
    await openApp(page, '/today');

    const family = page.getByRole('article').filter({ hasText: 'Квартира на Садовой' });
    await expect(family).toContainText('Передать до 25 окт.');
    await expect(family).toContainText('живём');

    // Рядом окно сдаваемой квартиры с другим сроком: по названию и статусу видно, какая нужна.
    const rented = page.getByRole('article').filter({ hasText: 'Квартира на Речной' });
    await expect(rented).toContainText('Передать до 23 окт.');
    await expect(rented).toContainText('сдаётся');

    await family.getByRole('link', { name: /Внести показания/ }).click();
    await expect(page).toHaveURL(/#\/home\/sadovaya\/readings$/);
    await expect(h1(page)).toHaveText('Показания');
    await expect(page.getByRole('heading', { level: 2, name: 'ХВС · Кухня' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'ГВС · Ванная' })).toBeVisible();
    await checkScreen(page, testInfo, 'task1-readings-screen', { noShot: true });
  });

  test('через «Дом»: карточка квартиры → «Счётчики» → «Внести показания»', async ({ page }) => {
    await openApp(page, '/today');
    await goToSection(page, 'Дом');
    await page.getByRole('link', { name: /Квартира на Садовой/ }).click();

    // На обзоре объекта видно ближайшее: окно показаний до 25 окт.
    await expect(
      page.getByRole('link', { name: /Окно показаний: вода и электроэнергия/ }),
    ).toContainText('до 25 окт.');

    await page
      .getByRole('navigation', { name: 'Разделы объекта' })
      .getByRole('link', { name: 'Счётчики' })
      .click();
    await page.getByRole('link', { name: 'Внести показания' }).click();
    await expect(h1(page)).toHaveText('Показания');
    await expect(page).toHaveURL(/#\/home\/sadovaya\/readings$/);
  });

  test('на экране ввода работает и запятая, и точка', async ({ page }) => {
    await openApp(page, '/home/sadovaya/readings');
    const first = page.getByRole('textbox', { name: /Новое значение, м³/ }).first();
    await first.fill('150,3');
    await expect(page.getByText('Расход: 2,788 м³')).toBeVisible();
    await first.fill('150.3');
    await expect(page.getByText('Расход: 2,788 м³')).toBeVisible();
  });
});

test.describe('Задание 2. Когда заканчивается страховка дачи', () => {
  test('через «Документы»: карточка «Страховка дачи» — до 14 нояб. 2026', async ({
    page,
  }, testInfo) => {
    await openApp(page, '/today');
    await goToSection(page, 'Документы');
    await expect(h1(page)).toHaveText('Документы');

    // В списке две страховки: дачи и квартиры — нужно выбрать верную.
    await expect(page.getByRole('link', { name: /Страховка квартиры на Садовой/ })).toBeVisible();
    await page.getByRole('link', { name: /Страховка дачи/ }).click();

    await expect(h1(page)).toHaveText('Страховка дачи');
    await expect(page.getByText('Истекает через 23 дня · 14 нояб.')).toBeVisible();
    const expires = page.locator('.facts__item').filter({ hasText: 'Срок действия' });
    await expect(expires).toContainText('до 14 нояб.');
    await checkScreen(page, testInfo, 'task2-document-card', { noShot: true });
  });

  test('через поиск: «страховка дачи»', async ({ page }) => {
    await openApp(page, '/today');
    await page.getByRole('link', { name: 'Поиск' }).click();
    await page.getByRole('searchbox', { name: 'Что найти' }).fill('страховка дачи');

    const result = page.getByRole('link', { name: /Страховка дачи/ });
    await expect(result).toBeVisible();
    await expect(page.getByRole('link', { name: /Страховка квартиры/ })).toHaveCount(0);
    await result.click();
    await expect(page.getByText('Истекает через 23 дня · 14 нояб.')).toBeVisible();
  });

  test('через «Дом»: карточка дачи → «Документы»', async ({ page }) => {
    await openApp(page, '/home');
    await page.getByRole('link', { name: /Дача «Сосновка»/ }).click();
    await page
      .getByRole('navigation', { name: 'Разделы объекта' })
      .getByRole('link', { name: 'Документы' })
      .click();
    await page.getByRole('link', { name: /Страховка дачи/ }).click();
    await expect(page.getByText('Истекает через 23 дня · 14 нояб.')).toBeVisible();
  });
});

test.describe('Задание 3. Телефон сантехника', () => {
  test('через «Люди»: карточка мастера с телефоном', async ({ page }, testInfo) => {
    await openApp(page, '/today');
    await goToSection(page, 'Люди');
    await page.getByRole('link', { name: /Пётр Семёнов/ }).click();

    await expect(h1(page)).toHaveText('Пётр Семёнов');
    await expect(page.getByText('Сантехник').first()).toBeVisible();
    await expect(page.getByRole('link', { name: '+7 (900) 555-01-23' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Позвонить' })).toHaveAttribute(
      'href',
      'tel:+79005550123',
    );
    await checkScreen(page, testInfo, 'task3-contact-card', { noShot: true });
  });

  test('через поиск: «сантехник» — телефон виден и копируется прямо из результата', async ({
    page,
  }) => {
    await openApp(page, '/today');
    await page.getByRole('link', { name: 'Поиск' }).click();
    await page.getByRole('searchbox', { name: 'Что найти' }).fill('сантехник');

    const result = page.getByRole('link', { name: /Пётр Семёнов/ });
    await expect(result).toContainText('+7 (900) 555-01-23');

    await page.getByRole('button', { name: 'Скопировать телефон' }).click();
    await expect(page.getByRole('status').getByText('Скопировано: телефон')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('+7 (900) 555-01-23');
  });

  test('через карточку квартиры: «Люди» объекта', async ({ page }) => {
    await openApp(page, '/home/sadovaya/people');
    await page.getByRole('link', { name: /Пётр Семёнов/ }).click();
    await expect(page.getByRole('link', { name: '+7 (900) 555-01-23' })).toBeVisible();
  });
});

test.describe('Задание 4. Заметка, которую не увидит никто, кроме вас', () => {
  test('«+» → «Заметка» → «Кто видит» = «Только я» → «Сохранить»', async ({ page }, testInfo) => {
    await openApp(page, '/today');
    await startAdd(page, 'Заметка');

    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Заголовок').fill('Подарок Игорю на юбилей');
    await dialog.getByLabel('Текст').fill('Часы или рюкзак. Пока не говорить.');

    // В режиме «Всё» заметка по умолчанию личная: строка «Кто видит» уже стоит на «Только я».
    const visibility = dialog.getByRole('group', { name: 'Кто видит' });
    await expect(visibility.getByRole('radio', { name: 'Только я' })).toBeChecked();
    await expect(visibility).toContainText('Видите только вы');
    await checkScreen(page, testInfo, 'task4-note-form', {
      targetsRoot: '[role="dialog"]',
      shot: 'viewport',
    });

    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('status')).toContainText('Заметка сохранена');
    await expect(page.getByRole('status')).toContainText('Кто видит: Только я');

    // Заметка лежит в «Ещё → Заметки» со значком замка.
    await goToSection(page, 'Ещё');
    await page.getByRole('link', { name: /Заметки/ }).click();
    const note = page.getByRole('link', { name: /Подарок Игорю на юбилей/ });
    await expect(note).toBeVisible();
    await expect(note.getByRole('img', { name: 'Кто видит: Только я' })).toBeVisible();
  });

  test('в режиме «Общее» по умолчанию стоит «Вся семья» — нужно выбрать «Только я»', async ({
    page,
  }) => {
    await openApp(page, '/more/notes');
    await setScope(page, 'Общее');
    await startAdd(page, 'Заметка');

    const dialog = page.getByRole('dialog');
    const visibility = dialog.getByRole('group', { name: 'Кто видит' });
    await expect(visibility.getByRole('radio', { name: 'Вся семья' })).toBeChecked();

    await dialog.getByLabel('Заголовок').fill('Сюрприз для всех');
    await visibility.getByRole('radio', { name: 'Только я' }).check();
    await dialog.getByRole('button', { name: 'Сохранить' }).click();

    // Режим «Общее» её не показывает — приложение говорит об этом и предлагает «Показать всё».
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Заметка сохранена');
    await expect(toast).toContainText('Режим «Общее» её не показывает');
    await expect(page.getByRole('link', { name: /Сюрприз для всех/ })).toHaveCount(0);

    await toast.getByRole('button', { name: 'Показать всё' }).click();
    await expect(page.getByRole('link', { name: /Сюрприз для всех/ })).toBeVisible();
  });
});

test.describe('Задание 5. Только общее семейное: видна ли заметка из задания 4', () => {
  test('в режиме «Общее» заметки из задания 4 нет, в «Личное» — есть', async ({
    page,
  }, testInfo) => {
    // Задание 4.
    await openApp(page, '/today');
    await startAdd(page, 'Заметка');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Заголовок').fill('Подарок Игорю на юбилей');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.getByRole('status')).toContainText('Заметка сохранена');

    // Задание 5: оставить на экране только общее.
    await goToSection(page, 'Ещё');
    await page.getByRole('link', { name: /Заметки/ }).click();
    await expect(page.getByRole('link', { name: /Подарок Игорю на юбилей/ })).toBeVisible();

    await setScope(page, 'Общее');
    await expect(page.getByRole('radio', { name: 'Общее' })).toBeChecked();
    await expect(page.getByRole('link', { name: /Подарок Игорю на юбилей/ })).toHaveCount(0);
    // Общие заметки на месте.
    await expect(page.getByRole('link', { name: /Вопросы к собранию жильцов/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ключи от дачи/ })).toBeVisible();
    // Личных значков нет ни у одной строки.
    await expect(page.getByRole('img', { name: 'Кто видит: Только я' })).toHaveCount(0);
    await checkScreen(page, testInfo, 'task5-notes-shared-only');

    // Ответ на вопрос задания — нет. А в режиме «Личное» заметка видна.
    await setScope(page, 'Личное');
    await expect(page.getByRole('link', { name: /Подарок Игорю на юбилей/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Ключи от дачи/ })).toHaveCount(0);
    await checkScreen(page, testInfo, 'task5-notes-personal-only', { noShot: false });
  });

  test('заметки нет и в поиске, пока включено «Общее»', async ({ page }) => {
    await openApp(page, '/today');
    await startAdd(page, 'Заметка');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Заголовок').fill('Подарок Игорю на юбилей');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();

    await setScope(page, 'Общее');
    await page.getByRole('link', { name: 'Поиск' }).click();
    await page.getByRole('searchbox', { name: 'Что найти' }).fill('юбилей');
    await expect(page.getByText('Ничего не найдено')).toBeVisible();
    await expect(page.getByText('во всех записях нашлось: 1')).toBeVisible();

    await page.getByRole('button', { name: 'Искать во всём' }).click();
    await expect(page.getByRole('link', { name: /Подарок Игорю на юбилей/ })).toBeVisible();
  });

  test('выбор «Общее» запоминается: после перезагрузки он на месте', async ({ page }) => {
    await openApp(page, '/more/notes');
    await setScope(page, 'Общее');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Общее' })).toBeChecked();
    await expectNoHorizontalScroll(page);
  });
});
