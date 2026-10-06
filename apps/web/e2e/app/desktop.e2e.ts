import { test } from '../auth/support/fixtures.ts';
import { setScope } from '../support/helpers.ts';
import { apiAs, noteLinks, seedNote } from './notes-support.ts';
import { checkApp, expect, seedProfiles, signInAs } from './support.ts';

// Компьютер (PRD, раздел 14): боковое меню со всеми разделами; переключатель пространств и
// поиск — в шапке. Нижнего меню на широком экране нет. Идёт на 1280 px, см. playwright.config.ts.

test('боковое меню вместо нижнего, переключатель и поиск в шапке', async ({
  page,
  family,
}, info) => {
  await seedProfiles(family);
  await signInAs(page, family, 'adult');

  const side = page.getByRole('navigation', { name: 'Основные разделы' });
  await expect(side).toBeVisible();
  await expect(page.locator('.bottom-nav')).toBeHidden();
  await expect(page.locator('nav:visible[aria-label="Основные разделы"]')).toHaveCount(1);
  await expect(side.getByRole('link')).toHaveText(['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']);
  await expect(side.getByRole('link', { name: 'Сегодня' })).toHaveAttribute('aria-current', 'page');

  // Шапка: переключатель и поиск рядом с содержимым, а не в боковом меню.
  const header = page.locator('header.topbar');
  await expect(header.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(header.getByRole('link', { name: 'Поиск', exact: true })).toBeVisible();
  await expect(side.getByRole('radio')).toHaveCount(0);
  await checkApp(page, info, 'desktop-today');

  for (const section of ['Дом', 'Документы', 'Люди', 'Ещё']) {
    await side.getByRole('link', { name: section, exact: true }).click();
    await expect(side.getByRole('link', { name: section, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('heading', { level: 1, name: section, exact: true })).toBeVisible();
  }
  await side.getByRole('link', { name: 'Люди', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Участники дома' }).getByRole('listitem'),
  ).toHaveCount(3);
  await setScope(page, 'Личное');
  await expect(side.getByRole('link', { name: 'Люди', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await checkApp(page, info, 'desktop-people-personal');
  await setScope(page, 'Всё');
  await checkApp(page, info, 'desktop-people');

  // Кнопка «+» не закрывает содержимое и остаётся у края окна.
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  await expect(add).toBeVisible();
  const box = await add.boundingBox();
  expect(box && box.x + box.width).toBeGreaterThan(1200);
});

test('заметки на компьютере: список, карточка и «Кто видит» рядом с боковым меню', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  await seedNote(boris, family, {
    title: 'Ремонт кухни',
    body: '# План\n\nНужна **краска** и скотч.',
    pinned: true,
    checklist: [{ title: 'Купить краску' }, { title: 'Позвонить мастеру', done: true }],
  });
  await seedNote(boris, family, {
    title: 'Правила дома',
    body: 'Обувь у двери.',
    audience: 'household',
  });
  await signInAs(page, family, 'adult');

  const side = page.getByRole('navigation', { name: 'Основные разделы' });
  await side.getByRole('link', { name: 'Ещё', exact: true }).click();
  await page.getByRole('link', { name: /^Заметки/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Заметки', exact: true })).toBeVisible();
  await expect(side.getByRole('link', { name: 'Ещё', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(noteLinks(page)).toHaveCount(2);
  await checkApp(page, info, 'desktop-notes');

  await noteLinks(page).filter({ hasText: 'Ремонт кухни' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Ремонт кухни', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Выполнено 1 из 2')).toBeVisible();
  await checkApp(page, info, 'desktop-note');

  await page.goto('#/more/notes');
  await noteLinks(page).filter({ hasText: 'Правила дома' }).click();
  await page.getByRole('button', { name: 'Кто видит…' }).click();
  await expect(page.getByRole('dialog', { name: 'Кто видит заметку' })).toBeVisible();
  await checkApp(page, info, 'desktop-note-audience');
});
