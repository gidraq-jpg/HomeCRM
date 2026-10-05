import { expect, test } from './support/fixtures.ts';
import { checkScreen, openApp, setScope } from './support/helpers.ts';

// Действия в карточке — PRD, 7.4: «Поделиться…» у личной записи, «Кто видит» и «Сделать личной…»
// у общей. Сужение доступа требует подтверждения и показывает, кто его потеряет (правило 7.3.8).

test('личный документ: «Поделиться со взрослыми» одним касанием', async ({ page }) => {
  await openApp(page, '/documents/doc-intl-passport');
  await expect(page.locator('.property-meta').getByText('Только я', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Поделиться со взрослыми' }).click();
  const toast = page.getByRole('status');
  await expect(toast).toContainText('Документ доступен взрослым');
  await expect(toast).toContainText('Кто видит: Взрослые');

  await expect(page.locator('.property-meta').getByText('Взрослые', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поделиться со взрослыми' })).toHaveCount(0);
  // Теперь у общей записи — «Кто видит…» и «Сделать личной…».
  await expect(page.getByRole('button', { name: 'Кто видит…' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сделать личной…' })).toBeVisible();
});

test('поделиться личным документом: в режиме «Личное» он пропадает из списка', async ({ page }) => {
  await openApp(page, '/documents/doc-oms');
  await setScope(page, 'Личное');
  await page.getByRole('button', { name: 'Поделиться со взрослыми' }).click();

  const toast = page.getByRole('status');
  await expect(toast).toContainText('Режим «Личное» его не показывает');
  await page.getByRole('link', { name: 'Документы', exact: true }).first().click();
  await expect(page.getByRole('list', { name: 'Документы' }).getByRole('listitem')).toHaveCount(2);

  await setScope(page, 'Общее');
  await expect(page.getByRole('link', { name: /Полис ОМС/ })).toBeVisible();
});

test('«Поделиться…» у личной заметки: выбор аудитории без «Только я»', async ({
  page,
}, testInfo) => {
  await openApp(page, '/more/notes/note-gifts');
  await page.getByRole('button', { name: 'Поделиться…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Поделиться' });
  const group = dialog.getByRole('group', { name: 'Кому показать' });
  await expect(group.getByRole('radio')).toHaveCount(2);
  await expect(group.getByRole('radio', { name: 'Только я' })).toHaveCount(0);
  await expect(group.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
  await checkScreen(page, testInfo, 'share-sheet', {
    targetsRoot: '[role="dialog"]',
    shot: 'viewport',
  });

  await group.getByRole('radio', { name: 'Вся семья' }).check();
  await dialog.getByRole('button', { name: 'Поделиться', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Запись видит вся семья');
  await expect(
    page.locator('.property-meta').getByText('Вся семья', { exact: true }),
  ).toBeVisible();
});

test('«Кто видит…»: сужение показывает, кто потеряет доступ', async ({ page }, testInfo) => {
  await openApp(page, '/people/plumber');
  await page.getByRole('button', { name: 'Кто видит…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Кто видит' });
  // Предлагается обратное текущему: «Вся семья» → «Взрослые» — это сужение, ребёнок теряет доступ.
  await expect(dialog.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
  await expect(dialog.getByRole('alert')).toContainText('Доступ потеряет: Ника');
  await checkScreen(page, testInfo, 'access-narrowing', {
    targetsRoot: '[role="dialog"]',
    shot: 'viewport',
  });

  // Расширять нечего: «Вся семья» — предупреждения нет.
  await dialog.getByRole('radio', { name: 'Вся семья' }).check();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'Взрослые' }).check();
  await dialog.getByRole('button', { name: 'Сохранить' }).click();

  await expect(page.getByRole('status')).toContainText('Запись видят взрослые');
  await expect(page.locator('.property-meta').getByText('Взрослые', { exact: true })).toBeVisible();
});

test('«Сделать личной…»: предупреждает, кто перестанет видеть, и убирает запись из «Общего»', async ({
  page,
}) => {
  await openApp(page, '/people/plumber');
  await page.getByRole('button', { name: 'Сделать личной…' }).click();

  const dialog = page.getByRole('dialog', { name: 'Сделать личной' });
  await expect(dialog.getByRole('alert')).toContainText('Доступ потеряет: Игорь и Ника');
  await dialog.getByRole('button', { name: 'Сделать личной' }).click();
  await expect(page.getByRole('status')).toContainText('Запись стала личной');
  await expect(page.locator('.property-meta').getByText('Только я', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Поделиться…' })).toBeVisible();

  await setScope(page, 'Общее');
  await page.getByRole('link', { name: 'Люди', exact: true }).first().click();
  await expect(page.getByRole('link', { name: /Пётр Семёнов/ })).toHaveCount(0);
  await setScope(page, 'Личное');
  await expect(page.getByRole('link', { name: /Пётр Семёнов/ })).toBeVisible();
});

test('объект «Взрослые» → «Вся семья»: расширение не требует подтверждения', async ({ page }) => {
  await openApp(page, '/home/sosnovka');
  await page.getByRole('button', { name: 'Кто видит…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Кто видит' });
  await expect(dialog.getByRole('radio', { name: 'Вся семья' })).toBeChecked();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByRole('status')).toContainText('Запись видит вся семья');
});
