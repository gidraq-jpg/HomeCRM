import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { RadarItem } from '../../src/deadlines/api.ts';
import { TaskCard } from '../../src/tasks/api.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openQuick,
  setScope,
  settle,
} from '../support/helpers.ts';
import { homeDate, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { seedDocument } from './documents-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs, openAs, seedObject } from './notes-support.ts';
import { seedAccount, seedLink, seedOrganization, seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

const directory = resolve(import.meta.dirname, '../../test-results/screens/UI-4');
test('Studio 2: сумма, окно и оплаченная доля из настоящего радара', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, { title: 'Квартира у озера', audience: 'adults' });
  const account = await seedAccount(api, flat.id, {
    title: 'Вода',
    data: {
      readingRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'month', day: Number(homeDate(0).slice(8)) },
      },
    },
  });
  const created = await api.post(`accounts/${account.id}/charges`, {
    period: homeDate(0).slice(0, 7),
    totalCents: 500000,
    dueOn: homeDate(0),
  });
  expect(created.status).toBe(201);
  const chargeId = (created.body as { id: string }).id;
  expect(
    await api.post(`charges/${chargeId}/payments`, {
      paidOn: homeDate(0),
      amountCents: 114000,
      payer: { kind: 'member', accountId: family.person('adult').id },
      method: 'card',
    }),
  ).toMatchObject({ status: 201 });
  await recalc(family);
  const radar = (await api.get(`deadlines?from=${homeDate(-1)}&to=${homeDate(7)}&view=mine`))
    .body as { items: unknown[] };
  const occurrence = RadarItem.array()
    .parse(radar.items)
    .find((item) => item.chargeId === chargeId);
  expect(occurrence).toBeDefined();
  const taken = await api.post('tasks/from-radar', { occurrenceId: occurrence?.id });
  expect([200, 201]).toContain(taken.status);
  const main = TaskCard.parse(taken.body);
  expect(await api.post(`tasks/${main.id}/main`, { selected: true })).toMatchObject({
    status: 200,
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  await expect(page.locator('.today-hints')).toContainText(/3\s860\s₽ к оплате/);
  await expect(page.locator('.today-hints')).toContainText('Показания до');
  await expect(page.locator('.today-hints__skeleton')).toHaveCount(0);
  await expect(page.locator('.today-hints')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.today-hints > :is(span, a)')).toHaveCount(2);
  await expect(page.getByRole('link', { name: /3\s860\s₽ к оплате/ })).toHaveAttribute(
    'href',
    /#\/home\/month\?month=/,
  );
  await expect(page.locator('.task-focus__remaining')).toContainText(/3\s860\s₽/);
  await expect(page.getByRole('progressbar', { name: 'Оплаченная доля' })).toHaveAttribute(
    'value',
    '114000',
  );
  await expect(page.getByText('Окно открыто', { exact: true })).toBeVisible();
  // Заготовка шапки сохраняет высоту при загрузке; карточка доступна над dock после прокрутки.
  await page.locator('.task-focus').evaluate((card) => card.scrollIntoView({ block: 'center' }));
  const mainBox = await page.locator('.task-focus').boundingBox();
  const dockBox = await page.locator('.bottom-nav').boundingBox();
  expect((mainBox?.y ?? 0) + (mainBox?.height ?? 0)).toBeLessThan(dockBox?.y ?? 0);
  await check(page, info, 'today-payment');
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const req of await (await caches.open(name)).keys()) urls.push(req.url);
    }
    return urls;
  });
  expect(cached.every((url) => !new URL(url).pathname.startsWith('/api/'))).toBe(true);
});
async function check(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  await expectAccessible(page, `Studio 2 · ${name}`);
  if (process.platform === 'linux') {
    await mkdir(directory, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: resolve(directory, `${info.project.name}-${name}.png`),
      fullPage: (await page.getByRole('dialog').count()) === 0,
    });
  }
}
test('Studio 2: полная лента, пространство, частичная ошибка и 200%', async ({
  page,
  family,
  context,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const personal = await seedObject(api, family, { title: 'Личная техника' });
  const common = await seedProperty(api, family, {
    title: 'Квартира у озера',
    audience: 'household',
    typeData: { address: 'ул. Учебная, 10', areaHundredths: 5400 },
  });
  await seedDeadline(api, 'objects', personal.id, { kind: 'date', date: homeDate(3) });
  await seedDeadline(api, 'objects', common.id, { kind: 'date', date: homeDate(4) });
  const created = await api.post('tasks', {
    title: 'Позвонить в управляющую компанию',
    planOn: homeDate(0),
  });
  expect(created.status).toBe(201);
  const main = TaskCard.parse(created.body);
  expect(await api.post(`tasks/${main.id}/main`, { selected: true })).toMatchObject({
    status: 200,
  });
  await api.post('tasks', {
    title: 'Общее дело',
    planOn: homeDate(0),
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await recalc(family);
  await signInAs(page, family, 'adult');
  const metrics = page.getByRole('navigation', { name: 'Показатели на сегодня' });
  await expect(metrics.getByRole('link', { name: '2 дела сегодня', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '2 объекта', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '4 близких срока', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  const focus = await page.locator('.task-focus').boundingBox();
  const dock = await page.locator('.bottom-nav').boundingBox();
  expect((focus?.y ?? 0) + (focus?.height ?? 0)).toBeLessThan(dock?.y ?? 0);
  await check(page, info, 'today-full');
  await setScope(page, 'Личное');
  await expect(metrics.getByRole('link', { name: '1 дело сегодня', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '1 объект', exact: true })).toBeVisible();
  await expect(metrics.getByRole('link', { name: '2 близких срока', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, info, 'today-full-text200');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%';
  });
  await context.route('**/api/objects?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":"TEST_FAILURE"}',
    }),
  );
  await page.reload();
  await expect(metrics.getByRole('link', { name: /объектов: Нет данных/ })).toContainText('—');
  await expect(metrics.getByRole('link', { name: '1 дело сегодня', exact: true })).toBeVisible();
  await check(page, info, 'today-error');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, info, 'today-text200');
});
test('Studio 2: объект, четыре чипа, снятие и создание дела', async ({ page, family }, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const object = await seedProperty(api, family, {
    title: 'Учебная',
    audience: 'household',
    typeData: { address: 'ул. Учебная, 10', areaHundredths: 5400 },
  });
  const organization = await seedOrganization(api, {
    title: 'УК «Учебный квартал»',
    data: { organizationType: 'management' },
  });
  await seedLink(api, object.id, organization.id, 'Управляющая компания');
  await seedMeter(api, object.id, {
    title: 'Холодная вода',
    data: { resource: 'cold_water', serialNumber: 'TEST-UI4-1' },
    initial: { occurredOn: homeDate(0), values: ['1245.3'] },
  });
  await seedDocument(api, {
    title: 'Договор обслуживания',
    type: 'other',
    indefinite: true,
    owner: { kind: 'object', id: object.id },
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}`);
  await expect(page.getByRole('heading', { name: 'Учебная', level: 1 })).toBeVisible();
  await check(page, info, 'object');
  await page.getByRole('button', { name: 'Кто видит объект', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Доступ к объекту', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Ещё: действия с объектом' }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Ещё', exact: true })
      .getByRole('button', { name: 'В корзину', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, info, 'object-text200');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.goto('#/today');
  await openQuick(page);
  const input = page.getByLabel('Быстрая строка');
  await input.fill('Позвонить завтра в 18:00 #Учебная @Борис');
  await expect(page.locator('.task-chip')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Добавить дело', exact: true })).toBeInViewport();
  await check(page, info, 'quick-four-chips');
  await page.getByRole('button', { name: 'Убрать время: 18:00' }).click();
  await expect(page.locator('.task-chip')).toHaveCount(3);
  await expect(page.locator('.quickline-result')).toContainText('в 18:00');
  await check(page, info, 'quick-three-chips');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, info, 'quick-text200');
  await page.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(page).toHaveURL(/tasks\/[a-f0-9-]+$/);
  const task = TaskCard.parse((await api.get(`tasks/${page.url().split('/').at(-1)}`)).body);
  expect(task.title).toBe('Позвонить в 18:00');
  expect(task.planTime).toBeNull();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '100%';
  });
  await page.goto(`#/home/${object.id}`);
  await page.getByRole('link', { name: 'Добавить дело к объекту' }).click();
  await expect(
    page.getByRole('group', { name: 'Кто видит' }).getByRole('radio', { name: 'Вся семья' }),
  ).toBeChecked();
  await page.getByLabel('Название дела').fill('Дело из карточки объекта');
  await page
    .locator('form.task-form')
    .getByRole('button', { name: 'Сохранить', exact: true })
    .click();
  await expect(page).toHaveURL(/tasks\/[a-f0-9-]+$/);
  const fromObject = TaskCard.parse((await api.get(`tasks/${page.url().split('/').at(-1)}`)).body);
  expect(fromObject.spaceId).toBe(family.houseId);
  const links = (await api.get(`records/task/${fromObject.id}/links`)).body as {
    left: { id: string };
    right: { id: string };
  }[];
  expect(links.some((link) => link.left.id === object.id || link.right.id === object.id)).toBe(
    true,
  );
});
test('Studio 2: нули и пустые списки на 100% и 200%', async ({ page, family }, info) => {
  await signInAs(page, family, 'adult');
  const metrics = page.getByRole('navigation', { name: 'Показатели на сегодня' });
  await expect(metrics).toContainText('дел нет');
  await expect(metrics).toContainText('сроков на подходе нет');
  await expect(metrics).toContainText('объектов под присмотром нет');
  await expect(page.locator('.today-hints')).toBeEmpty();
  await check(page, info, 'today-zero');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await check(page, info, 'today-zero-text200');
  for (const zoom of [100, 200]) {
    await page.evaluate((value) => {
      document.documentElement.style.fontSize = `${value}%`;
    }, zoom);
    for (const [path, title, empty] of [
      ['/home', 'Дом', 'Объектов пока нет'],
      ['/documents', 'Документы', 'Документов пока нет'],
      ['/people', 'Люди', 'Контактов пока нет'],
    ] as const) {
      await page.goto(`#${path}`);
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByText(empty, { exact: true })).toBeVisible();
      await check(page, info, `${path?.slice(1)}-empty-${zoom}`);
    }
  }
});
test('Studio 2: ребёнку не раскрываются личные и взрослые записи', async ({
  page,
  family,
  browser,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const secret = await seedObject(api, family, { title: 'Скрытая техника' });
  const adult = await seedProperty(api, family, { title: 'Квартира взрослых', audience: 'adults' });
  const account = await seedAccount(api, adult.id, {
    title: 'Вода взрослых',
    data: {
      readingRule: {
        kind: 'repeat',
        anchor: '2026-01-01',
        repeat: { unit: 'month', day: Number(homeDate(0).slice(8)) },
      },
    },
  });
  expect(
    await api.post(`accounts/${account.id}/charges`, {
      period: homeDate(0).slice(0, 7),
      totalCents: 742913,
      dueOn: homeDate(0),
    }),
  ).toMatchObject({ status: 201 });
  await seedMeter(api, adult.id, {
    title: 'Счётчик взрослых',
    utilityAccountId: account.id,
    data: { resource: 'cold_water', serialNumber: 'TEST-D12-PRIVATE' },
    initial: { occurredOn: homeDate(-1), values: ['9876.5'] },
  });
  const common = await seedObject(api, family, { title: 'Общая техника', audience: 'household' });
  for (const object of [secret, adult, common])
    await seedDeadline(api, 'objects', object.id, { kind: 'date', date: homeDate(3) });
  for (const audience of ['adults', 'household'])
    await api.post('tasks', {
      title: audience === 'adults' ? 'Скрытое дело взрослых' : 'Общее дело',
      planOn: homeDate(0),
      placement: { spaceId: family.houseId, audience },
    });
  await api.post('tasks', { title: 'Скрытое личное дело', planOn: homeDate(0) });
  await recalc(family);
  await signInAs(page, family, 'child');
  await expect(page.getByRole('link', { name: '1 дело сегодня', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '1 объект', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '0 близких сроков', exact: true })).toBeVisible();
  for (const hidden of [
    'Скрытая техника',
    'Квартира взрослых',
    'Скрытое дело взрослых',
    'Скрытое личное дело',
  ])
    await expect(page.getByText(hidden, { exact: false })).toHaveCount(0);
  await expect(page.locator('.today-hints')).toBeEmpty();
  await expect(page.getByText(/к оплате|Показания до|7\s429,13|9\s876,5/)).toHaveCount(0);
  await check(page, info, 'today-child');
  const adultPage = await openAs(browser, family, info, 'adult');
  try {
    await expect(
      adultPage.page.getByRole('link', { name: '3 дела сегодня', exact: true }),
    ).toBeVisible();
    await expect(adultPage.page.locator('.today-hints')).toContainText(/7\s429,13\s₽ к оплате/);
    await expect(adultPage.page.locator('.today-hints')).toContainText('Показания до');
  } finally {
    await adultPage.close();
  }
  await page.goto('#/home');
  await expect(page.getByRole('link', { name: /Общая техника/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Квартира взрослых|Скрытая техника/ })).toHaveCount(
    0,
  );
  await check(page, info, 'home-child');
});
test('Studio 2: снимки утверждённой разметки без внешних запросов', async ({
  page,
  family,
}, info) => {
  test.skip(
    info.project.name !== 'w412' || process.platform !== 'linux',
    'Эталоны снимаются один раз в Linux',
  );
  await page.goto(family.baseURL);
  for (const name of ['Main', 'Object', 'QuickAdd', 'System']) {
    const html = await readFile(
      resolve(
        process.env.HOMECRM_E2E_SOURCE ?? resolve(import.meta.dirname, '../../../..'),
        'docs/design/studio2',
        `${name}.dc.html`,
      ),
      'utf8',
    );
    const body = html
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<link[^>]*>/g, '')
      .replace(/<sc-if value="\{\{large\}\}"[\s\S]*?<\/sc-if>/g, '')
      .replaceAll('{{accent}}', '#ec8a62');
    await page.setViewportSize({ width: name === 'System' ? 640 : 390, height: 844 });
    await page.setContent(body);
    for (const weight of [300, 400, 500])
      for (const subset of ['cyrillic', 'latin']) {
        const font = await readFile(
          resolve(
            import.meta.dirname,
            `../../node_modules/@fontsource/onest/files/onest-${subset}-${weight}-normal.woff2`,
          ),
        );
        await page.addStyleTag({
          content: `@font-face {font-family:Onest;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-weight:${weight};unicode-range:${subset === 'cyrillic' ? 'U+0400-04FF,U+2116' : 'U+0000-00FF,U+2000-206F,U+20A0-20CF'};} body {margin:0}`,
        });
      }
    await page.evaluate(() => document.fonts.ready);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `reference-${name}.png`) });
  }
  for (const [reference, actual] of [
    ['Main', 'today-payment'],
    ['Object', 'object'],
    ['QuickAdd', 'quick-four-chips'],
  ] as const) {
    const before = await readFile(resolve(directory, `reference-${reference}.png`));
    const after = await readFile(resolve(directory, `w360-${actual}.png`));
    await page.setViewportSize({ width: 800, height: 920 });
    await page.setContent(
      `<html lang="ru"><body style="margin:0;padding:10px;box-sizing:border-box;background:#ddd6c9;font:14px system-ui"><div style="display:grid;grid-template-columns:390px 390px;gap:0"><div><p>Эталон Studio 2 · 390 px</p><img alt="Эталон" src="data:image/png;base64,${before.toString('base64')}" style="width:390px;height:844px;object-fit:cover;object-position:top"></div><div><p>Приложение · 360 px · начало страницы</p><img alt="Результат" src="data:image/png;base64,${after.toString('base64')}" style="width:390px;height:844px;object-fit:cover;object-position:top"></div></div></body></html>`,
    );
    await page.screenshot({ path: resolve(directory, `comparison-${reference}.png`) });
  }
});
