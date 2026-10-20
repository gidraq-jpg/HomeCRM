import type { Locator, Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, openRadar, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedPerson } from './people-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

async function rowWidth(row: Locator) {
  const width = await row
    .locator('.row__body')
    .first()
    .evaluate((body) => body.getBoundingClientRect().width);
  expect(width, 'Тексту остаётся место для слов целиком').toBeGreaterThan(150);
  await expect(row.locator('.row__title').first()).toHaveCSS('overflow-wrap', 'normal');
}

test('D20a-10/D20b: радар и связи оставляют название широким, меню рядом со строкой', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Вымышленная квартира у парка',
    audience: 'adults',
  });
  const note = await seedNote(api, family, {
    title: 'Документы вымышленной квартиры',
    audience: 'adults',
  });
  expect(
    (
      await api.post('links', {
        left: { type: 'object', id: flat.id },
        right: { type: 'note', id: note.id },
        role: 'Договор обслуживания',
      })
    ).status,
  ).toBe(201);
  await seedDeadline(api, 'objects', flat.id, { kind: 'date', date: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  const row = page.locator('.compact-radar-row').filter({ hasText: flat.title });
  await expect(row).toHaveCount(1);
  await rowWidth(row);
  const record = await row.locator('.compact-radar-row__record').boundingBox();
  const actions = await row.getByRole('button', { name: /^Ещё действия:/ }).boundingBox();
  expect(actions?.x).toBeGreaterThanOrEqual((record?.x ?? 0) + (record?.width ?? 0) - 1);
  await checkApp(page, info, 'D20a-10-radar');
  await page.goto(`#/home/${flat.id}`);
  const link = page.locator('.link-item').filter({ hasText: note.title });
  await expect(link).toBeVisible();
  await rowWidth(link);
  await checkApp(page, info, 'D20a-10-links');
});

test('D20a-11: плашка суммирует два месяца и открывает ранний; после срока — дата прошедшей оплаты', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Вымышленная квартира со счётом',
    audience: 'adults',
  });
  await seedProperty(api, family, { title: 'Вымышленный объект без счетов', audience: 'adults' });
  const account = await seedAccount(api, flat.id, { title: 'Вода' });
  const period = '2025-09';
  expect(
    (
      await api.post(`accounts/${account.id}/charges`, {
        period,
        totalCents: 12345,
        dueOn: homeDate(-1),
      })
    ).status,
  ).toBe(201);
  expect(
    (
      await api.post(`accounts/${account.id}/charges`, {
        period: '2025-10',
        totalCents: 9000,
        dueOn: homeDate(3),
      })
    ).status,
  ).toBe(201);
  await recalc(family);
  await signInAs(page, family, 'adult');
  const hint = page.getByRole('link', { name: /213,45\s₽ к оплате/ });
  await expect(hint).toBeVisible();
  await hint.click();
  await expect(page).toHaveURL(/month=2025-09/);
  await expect(page.locator('.month-switch__label')).toHaveText('Сентябрь 2025');
  await expect(page.getByText('Есть долг', { exact: true })).toHaveCount(0);
  await expect(page.locator('.month-object')).toHaveCount(1);
  await expect(page.locator('.month-object .status').first()).toHaveText(/Есть долг · срок был \d/);
  await expect(page.getByText(/Есть долг до/)).toHaveCount(0);
  await expect(page.locator('.month-object')).toContainText(/123,45\s₽/);
  await checkApp(page, info, 'D20a-11-month');
  await page.goto('#/more');
  await page.goto('#/home/month');
  await expect(page.locator('.month-switch__label')).toHaveText('Сентябрь 2025');
});

test('D20a-12: сохранение показаний объясняет результат, прошлый месяц не предлагается', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Вымышленная квартира с приборами',
    audience: 'adults',
  });
  const account = await seedAccount(api, flat.id, {
    title: 'Вода вручную',
    data: {
      transmission: { method: 'phone', phone: '000000' },
      readingRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'month', day: 1, endDay: 31 },
      },
    },
  });
  await seedMeter(api, flat.id, {
    title: 'Вымышленный водомер',
    utilityAccountId: account.id,
    data: { resource: 'cold_water' },
    initial: { occurredOn: '2025-01-01', values: ['100'] },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}/readings/transfer`);
  await expect(page.getByRole('heading', { name: 'Передавать нечего', exact: true })).toBeVisible();
  await checkApp(page, info, 'D20a-12-old-readings');
  await page.getByRole('link', { name: 'Ввести показания', exact: true }).click();
  await page.getByLabel('Новое значение, м³', { exact: true }).fill('110');
  await page.getByRole('button', { name: 'Сохранить всё', exact: true }).click();
  await expect(page.locator('.toast-region')).toContainText('Показания сохранены');
  await expect(page.locator('.toast-region')).not.toContainText('Осталось передать');
  await expect(page.getByRole('list', { name: 'Сохранённые показания' })).toContainText('110');
  await checkApp(page, info, 'D20a-12-saved');
  await page.goto(`#/home/month?month=${homeDate(0).slice(0, 7)}`);
  await expect(page.getByText('Показания сохранены · проверьте передачу')).toBeVisible();
  await checkApp(page, info, 'D20a-12-month');
});

test('D20a-13: видимое добавление, Enter, подсказка дубля и всё куплено', async ({
  page,
  family,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/shopping');
  const title = page.getByLabel('Добавить одной строкой');
  await title.fill('Молоко');
  const add = page.getByRole('button', { name: 'Добавить', exact: true });
  await expect(add).toBeVisible();
  await add.click();
  await expect(page.getByRole('link', { name: /^Молоко/ })).toBeVisible();
  await title.fill('  м о л о к о  ');
  await title.press('Enter');
  await expect(page.getByText('Уже в списке', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Без магазина', exact: true })).toBeVisible();
  await checkApp(page, info, 'D20a-13-duplicate');
  await page.getByRole('checkbox', { name: 'Молоко', exact: true }).click();
  await expect(page.getByText('Всё куплено', { exact: true })).toBeVisible();
  await expect(page.locator('.shopping-bought')).not.toHaveAttribute('open');
  await expect(page.locator('.shopping-bought summary')).toContainText('Куплено · 1');
  await expect(page.getByText('В списке пусто', { exact: true })).toHaveCount(0);
  await checkApp(page, info, 'D20a-13-bought');
  await title.fill('Хлеб');
  await title.press('Enter');
  await expect(page.getByRole('link', { name: /^Хлеб/ })).toBeVisible();
});

test('D20a-14: тексты семьи, русская дата, история создания и Markdown в поиске', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const task = await api.post('tasks', { title: 'Вымышленное дело для истории' });
  expect(task.status).toBe(201);
  const note = await seedNote(api, family, {
    title: 'Вымышленная памятка',
    body: '# Памятка\n\n**абрикосовый** пирог и [рецепт](https://example.com)',
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/today/tasks/${(task.body as { id: string }).id}`);
  await expect(page.locator('.task-history')).toContainText('Создано');
  await expect(page.locator('.task-history')).not.toContainText('Статус: —');
  await checkApp(page, info, 'D20a-14-history');
  await page.goto('#/today/new');
  await expect(page.getByText(/Europe\/Moscow/)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Дом для дат' })).not.toContainText('Дом 1');
  for (const field of await page.locator('input[type=date]').all())
    await expect(field).toHaveAttribute('lang', 'ru');
  await checkApp(page, info, 'D20a-14-date');
  await page.goto('#/search');
  await expect(page.getByText('В ваших личных и общих записях семьи.')).toBeVisible();
  await page.getByLabel('Что найти').fill('абрикосовый');
  const result = page.locator('.search-result').filter({ hasText: note.title });
  await expect(result).toBeVisible();
  await expect(result).not.toContainText('**');
  await expect(result.locator('mark')).toContainText('абрикосовый');
  await checkApp(page, info, 'D20a-14-search');
});

test('D20a-15: одна подпись ответственного, один звонок, дата срока документа', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const me = (await api.get('me')).body as { timeZone: string };
  await seedDocument(api, {
    title: 'Вымышленный полис',
    type: 'property_insurance',
    expiresOn: homeDate(20, me.timeZone),
    placement: { spaceId: family.houseId, audience: 'adults' },
  });
  const person = await seedPerson(api, {
    title: 'Вымышленный мастер',
    data: { phones: [{ number: '+7 (900) 000-00-00', label: 'Рабочий', emergency: false }] },
  });
  await signInAs(page, family, 'adult');
  await page.goto('#/documents');
  const row = page.getByRole('link', { name: /Вымышленный полис/ });
  await expect(row).toContainText(/Истекает через 20 дней · \d/);
  await checkApp(page, info, 'D20a-15-documents');
  await row.click();
  await expect(page.getByText('Ответственный', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Ответственный за продление', { exact: true })).toHaveCount(0);
  await checkApp(page, info, 'D20a-15-document');
  await page.goto(`#/people/contacts/${person.id}`);
  await expect(page.getByRole('link', { name: /^Позвонить/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: /^Набрать/ })).toHaveAttribute('href', /^tel:/);
  await checkApp(page, info, 'D20a-15-contact');
});

async function checkFocus(page: Page, target: Locator) {
  await page.keyboard.press('Tab');
  await target.focus();
  await page.keyboard.press('ArrowRight');
  await expect(target).toBeFocused();
  const colors = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const rgb =
        color
          .match(/\d+(?:\.\d+)?/g)
          ?.slice(0, 3)
          .map(Number) ?? [];
      return rgb.reduce((sum, c, i) => {
        const value = c / 255;
        return (
          sum +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            ([0.2126, 0.7152, 0.0722][i] ?? 0)
        );
      }, 0);
    };
    const contrast = (a: string, b: string) =>
      (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
    let parent: Element | null = element.parentElement;
    while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)')
      parent = parent.parentElement;
    const background = parent ? getComputedStyle(parent).backgroundColor : 'rgb(255, 255, 255)';
    const light = style.getPropertyValue('--focus-light').trim();
    return {
      outline: style.outlineColor,
      shadow: style.boxShadow,
      width: style.outlineWidth,
      visible: element.matches(':focus-visible'),
      contrast: Math.max(
        contrast(style.outlineColor, background),
        contrast('rgb(17, 17, 17)', background),
      ),
      light,
    };
  });
  expect(colors.visible).toBe(true);
  expect(colors.outline).toBe('rgb(255, 255, 255)');
  expect(colors.shadow).toContain('rgb(17, 17, 17)');
  expect(colors.width).toBe('3px');
  expect(colors.contrast).toBeGreaterThanOrEqual(3);
}

test('D20a-16: контраст фокуса на главной, доме, документах и в карточке дела', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  const task = await api.post('tasks', { title: 'Вымышленное дело с фокусом' });
  await seedProperty(api, family, { title: 'Вымышленный дом с фокусом', audience: 'adults' });
  await seedDocument(api, { title: 'Вымышленный документ с фокусом' });
  await signInAs(page, family, 'adult');
  for (const [route, name] of [
    ['/today', 'today'],
    ['/home', 'home'],
    ['/documents', 'documents'],
    [`/today/tasks/${(task.body as { id: string }).id}`, 'task'],
  ] as const) {
    await page.goto(`#${route}`);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name:
          name === 'task'
            ? 'Вымышленное дело с фокусом'
            : name === 'home'
              ? 'Дом'
              : name === 'documents'
                ? 'Документы'
                : 'Сегодня',
        exact: true,
      }),
    ).toBeVisible();
    await checkFocus(page, page.locator('.topbar a').first());
    await checkFocus(page, page.locator('main :is(a[href],button):visible').first());
    await checkFocus(page, page.locator('.studio-panel :is(a[href],button):visible').first());
    await checkApp(page, info, `D20a-16-${name}`);
  }
});
