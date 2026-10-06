import { expect, test } from '../support/fixtures.ts';
import { checkScreen, goToSection, openApp } from '../support/helpers.ts';

// Каждый раздел и экран из PRD, раздел 14: открывается, без ошибок в консоли, без горизонтальной
// прокрутки, цели нажатия от 44 px, axe без серьёзных замечаний. Скриншоты — в test-results/screens.

interface Screen {
  shot: string;
  route: string;
  heading: string;
}

const SCREENS: readonly Screen[] = [
  { shot: '01-today', route: '/today', heading: 'Сегодня' },
  { shot: '02-today-plan', route: '/today/plan', heading: 'План' },
  { shot: '03-today-all-tasks', route: '/today/all', heading: 'Все дела' },
  { shot: '04-home', route: '/home', heading: 'Дом' },
  { shot: '05-home-month', route: '/home/month', heading: 'Коммуналка за месяц' },
  { shot: '06-property-overview', route: '/home/sadovaya', heading: 'Квартира на Садовой' },
  {
    shot: '07-property-utilities',
    route: '/home/sadovaya/utilities',
    heading: 'Квартира на Садовой',
  },
  { shot: '08-property-meters', route: '/home/sadovaya/meters', heading: 'Квартира на Садовой' },
  { shot: '09-property-documents', route: '/home/sosnovka/documents', heading: 'Дача «Сосновка»' },
  { shot: '10-property-people', route: '/home/sadovaya/people', heading: 'Квартира на Садовой' },
  { shot: '11-property-feed', route: '/home/sadovaya/feed', heading: 'Квартира на Садовой' },
  { shot: '12-readings', route: '/home/sadovaya/readings', heading: 'Показания' },
  { shot: '13-documents', route: '/documents', heading: 'Документы' },
  { shot: '14-document-card', route: '/documents/doc-dacha-insurance', heading: 'Страховка дачи' },
  {
    shot: '15-document-card-personal',
    route: '/documents/doc-intl-passport',
    heading: 'Загранпаспорт',
  },
  { shot: '16-people', route: '/people', heading: 'Люди' },
  { shot: '17-contact-card', route: '/people/plumber', heading: 'Пётр Семёнов' },
  { shot: '18-more', route: '/more', heading: 'Ещё' },
  { shot: '19-notes', route: '/more/notes', heading: 'Заметки' },
  { shot: '20-note-card', route: '/more/notes/note-tap', heading: 'Течёт кран в ванной' },
  { shot: '21-shopping', route: '/more/shopping', heading: 'Покупки' },
  { shot: '22-radar', route: '/more/radar', heading: 'Радар' },
  { shot: '23-settings', route: '/more/settings', heading: 'Настройки' },
  { shot: '24-trash', route: '/more/trash', heading: 'Корзина' },
  { shot: '25-export', route: '/more/export', heading: 'Экспорт' },
  { shot: '26-spaces', route: '/more/spaces', heading: 'Как устроены личное и общее' },
  { shot: '27-search-empty', route: '/search', heading: 'Поиск' },
  { shot: '28-search-results', route: '/search?q=страховка', heading: 'Поиск' },
];

for (const screen of SCREENS) {
  test(`экран ${screen.route} — ${screen.heading}`, async ({ page }, testInfo) => {
    await openApp(page, screen.route);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(screen.heading);
    await checkScreen(page, testInfo, screen.shot);
  });
}

test('нижнее меню: пять разделов открываются по касанию', async ({ page }) => {
  await openApp(page, '/today');
  const nav = page.getByRole('navigation', { name: 'Основные разделы' });
  await expect(nav.getByRole('link')).toHaveText(['Сегодня', 'Дом', 'Документы', 'Люди', 'Ещё']);

  for (const [label, heading] of [
    ['Дом', 'Дом'],
    ['Документы', 'Документы'],
    ['Люди', 'Люди'],
    ['Ещё', 'Ещё'],
    ['Сегодня', 'Сегодня'],
  ] as const) {
    await goToSection(page, label);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  }
});

test('шапка и «+» есть на каждом экране', async ({ page }) => {
  for (const screen of SCREENS) {
    await openApp(page, screen.route);
    await expect(page.getByRole('radio', { name: 'Всё', exact: true }), screen.route).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Общее' }), screen.route).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Личное' }), screen.route).toBeVisible();
    await expect(
      page
        .getByRole('link', { name: 'Поиск' })
        .or(page.getByRole('button', { name: 'Закрыть поиск' })),
      screen.route,
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Добавить', exact: true }),
      screen.route,
    ).toBeVisible();
  }
});

test('когда окно сжимает экранная клавиатура, меню и «+» прячутся, потом возвращаются', async ({
  page,
}) => {
  await openApp(page, '/search');
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  const nav = page.getByRole('navigation', { name: 'Основные разделы' });

  // Фокус в поле сам по себе меню не прячет: оно уходит, только если окно действительно сжалось.
  await expect(page.getByRole('searchbox', { name: 'Что найти' })).toBeFocused();
  await expect(add).toBeVisible();

  const size = page.viewportSize();
  if (size === null) throw new Error('У окна нет размера');
  await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) });
  await expect(add).toBeHidden();
  await expect(nav).toBeHidden();

  await page.setViewportSize(size);
  await expect(add).toBeVisible();
  await expect(nav).toBeVisible();
});
