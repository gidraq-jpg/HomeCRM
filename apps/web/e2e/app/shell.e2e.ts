import { test } from '../auth/support/fixtures.ts';
import { goToSection, setScope } from '../support/helpers.ts';
import {
  checkApp,
  expect,
  openSection,
  PROTOTYPE_MARKERS,
  seedProfiles,
  signInAs,
} from './support.ts';

// Рабочая оболочка (R0.3b): вошедший участник видит настоящие разделы, а не прототип.

test('вымышленных данных прототипа нет, все пять разделов открываются', async ({
  page,
  family,
}, info) => {
  await seedProfiles(family);
  await signInAs(page, family, 'adult');
  const nav = page.getByRole('navigation', { name: 'Основные разделы' });
  await expect(nav.getByRole('link')).toHaveText(['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']);
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await checkApp(page, info, 'section-today');

  const sections: [string, string, string][] = [
    ['Дом', 'Объектов пока нет', 'home'],
    ['Документы', 'Документов пока нет', 'documents'],
    ['Люди', 'Участники дома', 'people'],
    ['Ещё', 'Обо мне', 'more'],
  ];
  for (const [section, marker, slug] of sections) {
    await goToSection(page, section);
    await expect(page.getByRole('heading', { level: 1, name: section, exact: true })).toBeVisible();
    await expect(page.getByText(marker, { exact: true }).first()).toBeVisible();
    await checkApp(page, info, `section-${slug}`);
  }
  for (const section of ['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']) {
    await goToSection(page, section);
    const text = await page.locator('body').innerText();
    for (const marker of PROTOTYPE_MARKERS)
      expect(text, `«${marker}» в «${section}»`).not.toContain(marker);
  }
});

test('пустые разделы честно говорят, что создавать пока нечего, и объясняют личное и общее', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await expect(page.getByRole('region', { name: 'Дел на сегодня пока нет' })).toBeVisible();
  await expect(
    page.getByText('Создавать дела в приложении пока нельзя', { exact: false }),
  ).toBeVisible();
  // Радар на «Сегодня»: срочного пока нет, сроков ни у кого нет.
  await expect(page.getByText('Срочного нет', { exact: false })).toBeVisible();
  await setScope(page, 'Личное');
  await expect(
    page.getByText('Здесь только ваши записи. Их не видит никто, кроме вас.'),
  ).toBeVisible();
  await checkApp(page, info, 'today-personal');
  await setScope(page, 'Общее');
  await expect(page.getByText('Здесь только общие записи дома', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: 'Как устроены личное и общее' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Как устроены личное и общее' }),
  ).toBeVisible();
  // Перед абзацем «Чего мы не обещаем» есть отступ (бэклог R0.3b).
  await expect(page.getByRole('heading', { level: 2, name: 'Чего мы не обещаем' })).toBeVisible();
  await checkApp(page, info, 'spaces');
});

test('переключатель «Всё · Общее · Личное» запоминается и фильтрует «Люди»', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await openSection(page, '/people', 'Люди');
  await expect(
    page.getByRole('list', { name: 'Участники дома' }).getByRole('listitem'),
  ).toHaveCount(3);

  await setScope(page, 'Личное');
  await expect(
    page.getByRole('heading', { level: 2, name: 'В режиме «Личное» людей нет' }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Участники дома' })).toHaveCount(0);
  await checkApp(page, info, 'people-personal');

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Личное', exact: true })).toBeChecked();
  await expect(
    page.getByRole('heading', { level: 2, name: 'В режиме «Личное» людей нет' }),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('homecrm.scope'))).toBe('personal');

  await page.getByRole('button', { name: 'Показать «Всё»' }).click();
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(page.getByRole('list', { name: 'Участники дома' })).toBeVisible();
  await setScope(page, 'Общее');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Общее', exact: true })).toBeChecked();
  await expect(page.getByRole('list', { name: 'Участники дома' })).toBeVisible();
});

test('«+»: взрослому — только заметка и объяснение, что остальное не готово', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить' });
  await expect(dialog).toContainText('пока создавать нельзя');
  await expect(dialog.getByRole('button', { name: /Участник дома/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Заметка/ })).toHaveCount(1);
  await checkApp(page, info, 'add-adult');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('«+»: администратору — заметка и приглашение участника', async ({ page, family }, info) => {
  await signInAs(page, family, 'admin');
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить' });
  await expect(dialog.getByRole('button', { name: 'Закрыть' })).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: /Участник дома/ })).toHaveCount(1);
  await checkApp(page, info, 'add-admin');
  await dialog.getByRole('button', { name: /Участник дома/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Пригласить участника' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('поиск и неизвестный адрес говорят прямо', async ({ page, family }, info) => {
  await signInAs(page, family, 'child');
  await page.getByRole('link', { name: 'Поиск', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Поиск' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Поиск по вашим записям' })).toBeVisible();
  await checkApp(page, info, 'search');
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();
  await page.goto('#/нет-такого-адреса');
  await expect(page.getByRole('heading', { level: 1, name: 'Страница не найдена' })).toBeVisible();
});
