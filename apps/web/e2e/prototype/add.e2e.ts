import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures.ts';
import { checkScreen, openApp, setScope, startAdd } from '../support/helpers.ts';

// Кнопка «+» на всех экранах: что добавить → форма со строкой «Кто видит» над «Сохранить».

interface Kind {
  label: string;
  titleField: string;
  saved: string;
  /** Где созданная запись видна: маршрут и как её найти. */
  route: string;
  find: (page: Page, title: string) => Locator;
}

const KINDS: readonly Kind[] = [
  {
    label: 'Дело',
    titleField: 'Что нужно сделать',
    saved: 'Дело добавлено',
    route: '/today',
    find: (page, title) => page.locator('.task-row').filter({ hasText: title }),
  },
  {
    label: 'Заметка',
    titleField: 'Заголовок',
    saved: 'Заметка сохранена',
    route: '/more/notes',
    find: (page, title) => page.getByRole('link', { name: new RegExp(title) }),
  },
  {
    label: 'Покупка',
    titleField: 'Что купить',
    saved: 'Покупка добавлена',
    route: '/more/shopping',
    find: (page, title) => page.locator('.task-row').filter({ hasText: title }),
  },
  {
    label: 'Документ',
    titleField: 'Название документа',
    saved: 'Документ добавлен',
    route: '/documents',
    find: (page, title) => page.getByRole('link', { name: new RegExp(title) }),
  },
  {
    label: 'Контакт',
    titleField: 'Имя или название',
    saved: 'Контакт добавлен',
    route: '/people',
    find: (page, title) => page.getByRole('link', { name: new RegExp(title) }),
  },
  {
    label: 'Объект',
    titleField: 'Название объекта',
    saved: 'Объект добавлен',
    route: '/home',
    find: (page, title) => page.getByRole('link', { name: new RegExp(title) }),
  },
];

const dialogOf = (page: Page) => page.getByRole('dialog');

test('«+» открывает «Что добавить?» с шестью видами записей', async ({ page }, testInfo) => {
  await openApp(page, '/today');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();

  const dialog = dialogOf(page);
  await expect(dialog.getByRole('heading', { name: 'Что добавить?' })).toBeVisible();
  const choices = dialog.getByRole('list', { name: 'Что добавить' }).getByRole('button');
  await expect(choices).toHaveCount(6);
  await expect(choices.first()).toContainText('Дело');
  await checkScreen(page, testInfo, 'add-01-chooser', {
    targetsRoot: '[role="dialog"]',
    shot: 'viewport',
  });

  // Esc закрывает панель, фокус возвращается на «+».
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeFocused();
});

test('первым в списке стоит вид записи, которому соответствует экран', async ({ page }) => {
  const expected: readonly (readonly [string, string])[] = [
    ['/today', 'Дело'],
    ['/home', 'Объект'],
    ['/home/sadovaya', 'Объект'],
    ['/documents', 'Документ'],
    ['/people', 'Контакт'],
    ['/more/notes', 'Заметка'],
    ['/more/shopping', 'Покупка'],
    ['/more', 'Дело'],
    ['/search', 'Дело'],
  ];
  for (const [route, first] of expected) {
    await openApp(page, route);
    await page.getByRole('button', { name: 'Добавить', exact: true }).click();
    const choices = dialogOf(page).getByRole('list', { name: 'Что добавить' }).getByRole('button');
    await expect(choices.first(), route).toContainText(first);
    await page.keyboard.press('Escape');
  }
});

test.describe('строка «Кто видит» стоит над «Сохранить» в каждой форме', () => {
  for (const kind of KINDS) {
    test(kind.label, async ({ page }, testInfo) => {
      await openApp(page, '/today');
      await startAdd(page, kind.label);
      const dialog = dialogOf(page);
      await expect(dialog.getByLabel(kind.titleField)).toBeVisible();

      const visibility = dialog.getByRole('group', { name: 'Кто видит' });
      const save = dialog.getByRole('button', { name: 'Сохранить' });
      await expect(visibility.getByRole('radio')).toHaveCount(3);

      // Порядок в разметке: «Кто видит» раньше «Сохранить».
      const domOrder = await dialog.evaluate((root) => {
        const fieldset = root.querySelector('fieldset.visibility');
        const button = [...root.querySelectorAll('button')].find(
          (item) => item.textContent?.trim() === 'Сохранить',
        );
        if (!fieldset || !button) return null;
        return fieldset.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING;
      });
      expect(domOrder, 'в разметке «Кто видит» идёт до «Сохранить»').toBeTruthy();

      // И на экране строка выше кнопки.
      const visibilityBox = await visibility.boundingBox();
      const saveBox = await save.boundingBox();
      expect(visibilityBox && saveBox && visibilityBox.y + visibilityBox.height <= saveBox.y).toBe(
        true,
      );

      await checkScreen(page, testInfo, `add-form-${kind.route.replaceAll('/', '') || 'today'}`, {
        targetsRoot: '[role="dialog"]',
        shot: 'viewport',
      });
    });
  }
});

test.describe('значение «Кто видит» по умолчанию — таблица 7.2 и режим в шапке', () => {
  const table: readonly (readonly [string, 'Всё' | 'Общее' | 'Личное', string])[] = [
    ['Дело', 'Всё', 'Только я'],
    ['Заметка', 'Всё', 'Только я'],
    ['Покупка', 'Всё', 'Вся семья'],
    ['Документ', 'Всё', 'Только я'],
    ['Контакт', 'Всё', 'Вся семья'], // «Мастер» по умолчанию — общий
    ['Объект', 'Всё', 'Взрослые'],
    ['Дело', 'Общее', 'Вся семья'],
    ['Заметка', 'Общее', 'Вся семья'],
    ['Покупка', 'Общее', 'Вся семья'],
    ['Документ', 'Общее', 'Взрослые'],
    ['Контакт', 'Общее', 'Вся семья'],
    ['Объект', 'Общее', 'Взрослые'],
    ['Дело', 'Личное', 'Только я'],
    ['Заметка', 'Личное', 'Только я'],
    ['Покупка', 'Личное', 'Только я'],
    ['Документ', 'Личное', 'Только я'],
    ['Контакт', 'Личное', 'Только я'],
    ['Объект', 'Личное', 'Только я'],
  ];
  for (const [kind, scope, expected] of table) {
    test(`${kind} в режиме «${scope}» — «${expected}»`, async ({ page }) => {
      await openApp(page, '/today');
      await setScope(page, scope);
      await startAdd(page, kind);
      const visibility = dialogOf(page).getByRole('group', { name: 'Кто видит' });
      await expect(visibility.getByRole('radio', { name: expected })).toBeChecked();
    });
  }

  test('контакт: «Друг или коллега» по умолчанию личный, «Организация» — общая', async ({
    page,
  }) => {
    await openApp(page, '/people');
    await startAdd(page, 'Контакт');
    const dialog = dialogOf(page);
    const visibility = dialog.getByRole('group', { name: 'Кто видит' });
    await dialog.getByLabel('Кто это').selectOption('Друг или коллега');
    await expect(visibility.getByRole('radio', { name: 'Только я' })).toBeChecked();
    await dialog.getByLabel('Кто это').selectOption('Организация');
    await expect(visibility.getByRole('radio', { name: 'Вся семья' })).toBeChecked();
  });

  test('выбранное вручную значение не сбивается сменой других полей', async ({ page }) => {
    await openApp(page, '/people');
    await startAdd(page, 'Контакт');
    const dialog = dialogOf(page);
    const visibility = dialog.getByRole('group', { name: 'Кто видит' });
    await visibility.getByRole('radio', { name: 'Взрослые' }).check();
    await dialog.getByLabel('Кто это').selectOption('Друг или коллега');
    await expect(visibility.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await expect(visibility).toContainText('Видят все взрослые дома');
  });

  test('в карточке общего объекта дела и заметки по умолчанию наследуют его доступ', async ({
    page,
  }) => {
    await openApp(page, '/home/sadovaya');
    await startAdd(page, 'Заметка');
    let dialog = dialogOf(page);
    await expect(dialog.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
    await expect(dialog).toContainText('Запись создаётся в карточке «Квартира на Садовой»');
    await page.keyboard.press('Escape');

    // В режиме «Личное» заметка к общей квартире остаётся личной: её видит только автор.
    await setScope(page, 'Личное');
    await startAdd(page, 'Заметка');
    dialog = dialogOf(page);
    await expect(dialog.getByRole('radio', { name: 'Только я' })).toBeChecked();
  });
});

test('обязательно только название: без него форма не сохраняется', async ({ page }) => {
  await openApp(page, '/more/notes');
  await startAdd(page, 'Заметка');
  const dialog = dialogOf(page);
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(dialog.getByRole('alert')).toContainText('Напишите название');
  await expect(dialog.getByLabel('Заголовок')).toBeFocused();
  await expect(dialog.getByLabel('Заголовок')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog).toBeVisible();

  // Достаточно одного названия.
  await dialog.getByLabel('Заголовок').fill('Только название');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Только название/ })).toBeVisible();
});

test.describe('каждая запись сохраняется и появляется в своём разделе', () => {
  for (const kind of KINDS) {
    test(kind.label, async ({ page }) => {
      const title = `Проверка ${kind.label.toLowerCase()} 7`;
      await openApp(page, kind.route);
      await startAdd(page, kind.label);
      const dialog = dialogOf(page);
      await dialog.getByLabel(kind.titleField).fill(title);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();

      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('status')).toContainText(kind.saved);
      await expect(kind.find(page, title).first()).toBeVisible();

      // Запись переживает перезагрузку страницы — прототип хранит её на устройстве.
      await page.reload();
      await expect(kind.find(page, title).first()).toBeVisible();
    });
  }
});

test('если режим в шапке скрывает новую запись, приложение объясняет это и предлагает «Показать всё»', async ({
  page,
}) => {
  await openApp(page, '/more/shopping');
  await setScope(page, 'Личное');
  // Пустой раздел предлагает первое действие.
  await page.getByRole('button', { name: 'Добавить покупку' }).click();
  const dialog = dialogOf(page);
  await dialog.getByLabel('Что купить').fill('Батарейки');
  await dialog.getByRole('radio', { name: 'Вся семья' }).check();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  const toast = page.getByRole('status');
  await expect(toast).toContainText('Покупка добавлена');
  await expect(toast).toContainText('Кто видит: Вся семья. Режим «Личное» её не показывает.');
  await expect(page.getByText('Батарейки')).toHaveCount(0);

  await toast.getByRole('button', { name: 'Показать всё' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(page.getByText('Батарейки')).toBeVisible();
});

test('личная заметка к общему объекту видна в его ленте только автору', async ({ page }) => {
  await openApp(page, '/home/sadovaya');
  await setScope(page, 'Личное');
  await startAdd(page, 'Заметка');
  const dialog = dialogOf(page);
  await dialog.getByLabel('Заголовок').fill('Спросить про ремонт балкона');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await page
    .getByRole('navigation', { name: 'Разделы объекта' })
    .getByRole('link', { name: 'Лента' })
    .click();
  const note = page.getByRole('link', { name: /Заметка: Спросить про ремонт балкона/ });
  await expect(note).toBeVisible();
  await expect(note.getByRole('img', { name: 'Кто видит: Только я' })).toBeVisible();

  // В режиме «Общее» личные события в ленту общего объекта не попадают (правило 7.3.2).
  await setScope(page, 'Общее');
  await expect(note).toHaveCount(0);
  await expect(page.getByText('Показания переданы')).toBeVisible();
});
