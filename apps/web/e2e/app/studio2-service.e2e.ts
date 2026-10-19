import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { scheduleSummaries } from '../../../server/src/notifications/summaries.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
} from '../support/helpers.ts';
import { homeDate, recalc, seedDeadline, setHomeZone } from './deadlines-support.ts';
import { apiAs, seedNote } from './notes-support.ts';
import { seedAttempt, seedDevice } from './notifications-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { seedProfiles, signInAs } from './support.ts';

test.use({ actionTimeout: 10_000 });

const phase = process.env.UI6_PHASE === 'before' ? 'before' : 'after';
test('UI-6 D16b: служебные экраны, данные и пустые состояния', async ({ page, family }, info) => {
  test.setTimeout(360_000);
  await seedProfiles(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Вымышленная квартира',
    audience: 'household',
  });
  const account = await seedAccount(api, flat.id, { title: 'Вымышленный счёт' });
  const note = await seedNote(api, family, { title: 'Вымышленная заметка', audience: 'household' });
  await signInAs(page, family, 'admin');
  const screens = [
    ['more', '/more'],
    ['search-empty', '/search'],
    ['search-results', '/search'],
    ['profile', '/more/profile'],
    ['security', '/more/settings'],
    ['export', '/more/export'],
    ['member', `/people/members/${family.person('adult').id}`],
    ['member-missing', `/people/members/${crypto.randomUUID()}`],
    ['invite', '/people/invite'],
    ['spaces', '/more/spaces'],
    ['house', '/more/house'],
    ['notifications', '/more/notifications'],
    ['summaries-empty', '/more/summaries'],
    ['deliveries-empty', '/more/notifications/log'],
    ['trash-empty', '/more/trash'],
    ['month', '/home/month'],
    ['charges-empty', `/home/${flat.id}/accounts/${account.id}/charges`],
    ['start-house', '/start/house'],
    ['start-template', '/start/template'],
    ['start-object', '/start/object/apartment'],
    ['start-invite', '/start/invite'],
    ['import', '/people/import'],
    ['not-found', '/unknown-service'],
    ['open-missing', `/open/${crypto.randomUUID()}`],
  ] as const;
  const dir = resolve(import.meta.dirname, '../../test-results/screens/UI-6', phase);
  await mkdir(dir, { recursive: true });
  for (const percent of phase === 'before' ? [100] : [100, 200]) {
    for (const [name, route] of screens) {
      await page.goto(`#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByText(/^Загружаем|^Открываем запись…$/)).toHaveCount(0);
      await page.evaluate((p) => {
        document.documentElement.style.fontSize = `${p}%`;
      }, percent);
      if (name === 'search-results') {
        await page.getByLabel('Что найти').fill('Вымышленная');
        await expect(page.getByRole('link', { name: /Вымышленная заметка/ })).toBeVisible();
      }
      await page.evaluate(() => document.fonts.ready);
      if (phase === 'after') {
        await expect(page.locator('.studio-list-hero .studio-add')).toHaveCount(0);
        await expectNoHorizontalScroll(page);
        await expectAccessible(page, name);
        await expectTouchTargets(page);
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: resolve(dir, `service-${name}-${info.project.name}-${percent}.png`),
        fullPage: true,
      });
    }
  }
  await page.goto(`#/open/${note.id}`);
  await expect(page).toHaveURL(new RegExp(`/more/notes/${note.id}$`));
});

test('UI-6 D16b: Назад служебных экранов возвращает по истории', async ({ page, family }) => {
  await signInAs(page, family, 'adult');
  const screens = [
    ['/today', '/search'],
    ['/home', '/unknown-service'],
    ['/people', `/open/${crypto.randomUUID()}`],
  ] as const;
  for (const [origin, destination] of screens) {
    await page.goto(`#${origin}`);
    await expect(page.locator('h1')).toBeVisible();
    if (origin === '/home')
      await expect(page.locator('.studio-list-hero .studio-add')).toHaveCount(1);
    await page.goto(`#${destination}`);
    const back = page.getByRole('button', { name: 'Назад', exact: true });
    await expect(back).toBeVisible();
    await expect(page.locator('.studio-list-hero .studio-add')).toHaveCount(0);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`#${origin}$`));
  }
});

async function capture(page: Page, info: TestInfo, name: string) {
  await expect(page.getByText(/^Загружаем|^Открываем запись…$/)).toHaveCount(0);
  if (phase === 'after') {
    await expectNoHorizontalScroll(page);
    await expectAccessible(page, name);
    await expectTouchTargets(page);
  }
  const dir = resolve(import.meta.dirname, '../../test-results/screens/UI-6', phase);
  await mkdir(dir, { recursive: true });
  const dialogOpen =
    (await page.getByRole('dialog').count()) + (await page.getByRole('alertdialog').count()) > 0;
  await page.screenshot({
    path: resolve(dir, `service-${name}-${info.project.name}.png`),
    fullPage: !dialogOpen,
  });
}

test('UI-6 D16b: заполненные списки, формы, листы и главные действия', async ({
  page,
  family,
}, info) => {
  test.setTimeout(300_000);
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Вымышленная квартира',
    audience: 'household',
  });
  const account = await seedAccount(api, flat.id, { title: 'Вымышленный счёт' });
  const charge = await api.post(`accounts/${account.id}/charges`, {
    period: homeDate(0).slice(0, 7),
    totalCents: 123450,
    dueOn: homeDate(2),
  });
  expect(charge.status).toBe(201);
  const note = await seedNote(api, family, {
    title: 'Вымышленная просрочка',
    audience: 'household',
  });
  await seedDeadline(api, 'notes', note.id, { kind: 'date', date: homeDate(-2) });
  await recalc(family);
  await scheduleSummaries(family.database.worker, new Date(Date.now() + 86400000));
  const summaries = (await api.get('summaries')).body as { id: string }[];
  expect(summaries.length).toBeGreaterThan(0);
  const device = await seedDevice(api, 'Вымышленный телефон', 'ui6-service');
  await seedAttempt(family, family.person('adult').id, device, { result: 'sent', minutesAgo: 3 });
  const trash = await seedNote(api, family, { title: 'Вымышленная удалённая заметка' });
  expect((await api.post(`notes/${trash.id}/trash`, {})).status).toBe(200);
  await signInAs(page, family, 'adult');
  for (const percent of phase === 'before' ? [100] : [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [name, route] of [
      ['summaries-list', '/more/summaries'],
      ['summary', `/more/summaries/${summaries[0]?.id}`],
      ['deliveries', '/more/notifications/log'],
      ['notifications-devices', '/more/notifications'],
      ['trash', '/more/trash'],
      ['month-charged', '/home/month'],
      ['charges', `/home/${flat.id}/accounts/${account.id}/charges`],
    ]) {
      await page.goto(`#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await capture(page, info, `${name}-${percent}`);
    }
    await page.getByRole('button', { name: 'Добавить оплату', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Оплата', exact: true })).toBeVisible();
    await capture(page, info, `charge-payment-${percent}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить начисление', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Новое начисление', exact: true }),
    ).toBeVisible();
    await capture(page, info, `charge-form-${percent}`);
    await page.goto('#/more/profile');
    await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    await expect(page.getByLabel('Имя', { exact: true })).toBeVisible();
    await capture(page, info, `profile-form-${percent}`);
    await page.getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.getByRole('button', { name: 'Уйти из дома', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await capture(page, info, `profile-leave-${percent}`);
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Отмена', exact: true })
      .click();
    await page.goto('#/people/import');
    await page.getByLabel('Файл контактов').setInputFiles({
      name: 'fiction.vcf',
      mimeType: 'text/vcard',
      buffer: Buffer.from(
        'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Вымышленный Контакт\r\nTEL:+79990000001\r\nEND:VCARD\r\n',
      ),
    });
    await expect(page.getByRole('heading', { name: 'Предпросмотр', exact: true })).toBeVisible();
    await capture(page, info, `import-preview-${percent}`);
  }
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await expect(page.getByText(/Добавлено 1\sконтакт/)).toBeVisible();
  await page.goto('#/more/profile');
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Борис Вымышленный');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.locator('.toast-region')).toContainText('Профиль сохранён');
  await page.goto('#/more/notifications');
  await page.getByRole('checkbox', { name: /^Утренняя/ }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click();
  await expect(page.locator('.toast-region')).toContainText('Настройки уведомлений сохранены');
  await page.goto('#/more/trash');
  await page
    .getByRole('list', { name: 'Удалённые заметки' })
    .getByRole('button', { name: /Восстановить/ })
    .click();
  await expect(page.getByRole('list', { name: 'Удалённые заметки' })).toHaveCount(0);
});

test('UI-6 D16b: ребёнок не видит взрослое и чужое личное в поиске, месяце и корзине', async ({
  page,
  family,
}) => {
  test.skip(phase === 'before');
  const api = await apiAs(family, 'adult');
  const flat = await seedProperty(api, family, {
    title: 'Запретная взрослая квартира',
    audience: 'adults',
  });
  const personal = await seedNote(api, family, { title: 'Запретная личная заметка' });
  const adults = await seedNote(api, family, {
    title: 'Запретная взрослая заметка',
    audience: 'adults',
  });
  await signInAs(page, family, 'child');
  for (const route of ['/home/month', '/more/trash', '/search']) {
    await page.goto(`#${route}`);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
    if (route === '/search') {
      await page.getByLabel('Что найти').fill('Запретная');
      await expect(page.getByText('Ничего не найдено', { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('main')).not.toContainText('Запретная');
  }
  for (const route of [
    `/home/${flat.id}`,
    `/more/notes/${personal.id}`,
    `/more/notes/${adults.id}`,
  ]) {
    await page.goto(`#${route}`);
    await expect(page.getByText(/^Загружаем/)).toHaveCount(0);
    await expect(page.locator('h1')).not.toContainText('Запретная');
  }
});

test('UI-6 D16b: администратор, приглашение, роль, экспорт и мастер', async ({
  page,
  family,
}, info) => {
  test.setTimeout(180_000);
  await signInAs(page, family, 'admin');
  for (const percent of phase === 'before' ? [100] : [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    await page.goto(`#/people/members/${family.person('adult').id}`);
    await page.getByRole('button', { name: 'Сменить роль', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Сменить роль', exact: true })).toBeVisible();
    await capture(page, info, `member-role-${percent}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
    await page.goto('#/people/invite');
    await page.getByRole('button', { name: 'Создать ссылку-приглашение', exact: true }).click();
    await expect(page.getByText('Ссылка показывается один раз.', { exact: true })).toBeVisible();
    // Ссылка-приглашение содержит одноразовый тестовый токен: в артефакте он закрыт маской.
    const dir = resolve(import.meta.dirname, '../../test-results/screens/UI-6', phase);
    if (phase === 'after') {
      await expectAccessible(page, 'invite-issued');
      await expectNoHorizontalScroll(page);
      await expectTouchTargets(page);
    }
    await page.screenshot({
      path: resolve(dir, `service-invite-issued-${info.project.name}-${percent}.png`),
      fullPage: true,
      mask: [page.locator('.issued-link')],
    });
    await page.goto('#/more/house');
    await page
      .getByLabel('Новый часовой пояс')
      .selectOption(percent === 100 ? 'Europe/Moscow' : 'Asia/Yekaterinburg');
    await page.getByRole('button', { name: 'Сохранить часовой пояс' }).click();
    await expect(page.locator('.toast-region')).toContainText('Часовой пояс дома изменён');
    await page.goto('#/start/house');
    await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
    await expect(page).toHaveURL(/#\/start\/template$/);
    await page.getByRole('button', { name: 'Пропустить', exact: true }).click();
    await expect(page).toHaveURL(/#\/start\/invite$/);
    await page.getByRole('button', { name: 'Пропустить и закончить', exact: true }).click();
    await expect(page).toHaveURL(/#\/today$/);
  }
  await page.goto('#/more/export');
  const personal = page
    .locator('.section')
    .filter({ has: page.getByRole('heading', { name: 'Моё личное', exact: true }) });
  await personal
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('admin').password);
  await personal.getByRole('checkbox').check();
  const download = page.waitForEvent('download');
  await personal.getByRole('button', { name: 'Скачать моё личное' }).click();
  expect((await download).suggestedFilename()).toBe('homecrm-personal.zip');
  await expect(page.getByRole('heading', { name: 'История выгрузок' })).toBeVisible();
  await capture(page, info, `export-history-${phase === 'before' ? 100 : 200}`);
});

test('UI-6 D16b: RecordPage закрывает Ещё перед следующим листом и после действия', async ({
  page,
  family,
}, info) => {
  test.skip(phase === 'before');
  test.setTimeout(120_000);
  const api = await apiAs(family, 'adult');
  const personal = await seedNote(api, family, { title: 'Вымышленная личная заметка' });
  const shared = await seedNote(api, family, {
    title: 'Вымышленная общая заметка',
    audience: 'household',
  });
  const task = await api.post('tasks', {
    title: 'Вымышленное дело',
    placement: { spaceId: family.houseId, audience: 'household' },
  });
  expect(task.status).toBe(201);
  await signInAs(page, family, 'adult');
  const more = page.getByRole('dialog', { name: 'Ещё', exact: true });
  for (const percent of [100, 200]) {
    await page.evaluate((p) => {
      document.documentElement.style.fontSize = `${p}%`;
    }, percent);
    for (const [id, action, title] of [
      [personal.id, 'Поделиться…', 'Поделиться заметкой'],
      [shared.id, 'Кто видит…', 'Кто видит заметку'],
    ]) {
      await page.goto(`#/more/notes/${id}`);
      await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
      await more.getByRole('button', { name: action, exact: true }).click();
      await expect(more).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
      await capture(
        page,
        info,
        `record-access-${id === personal.id ? 'share' : 'audience'}-${percent}`,
      );
      await page.getByRole('dialog').getByRole('button', { name: 'Отмена', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ещё: действия с записью' })).toBeFocused();
    }
    await page.goto(`#/today/tasks/${(task.body as { id: string }).id}`);
    await expect(page.getByText(/PDF до 25 МБ/)).toHaveCount(1);
    await capture(page, info, `record-task-${percent}`);
    await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
    const transfer = more.getByRole('button', { name: 'Передать…', exact: true });
    if (percent === 200) await transfer.press('Enter');
    else await transfer.click();
    await expect(more).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await capture(page, info, `record-transfer-${percent}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Ещё: действия с записью' })).toBeFocused();
  }
  await page.goto(`#/more/notes/${personal.id}`);
  await page.getByRole('button', { name: 'Ещё: действия с записью' }).click();
  await more.getByRole('button', { name: 'В корзину', exact: true }).click();
  await expect(more).toHaveCount(0);
  await expect(page.locator('.toast-region')).toContainText('Заметка в корзине');
});

test('UI-6 D16b: Onest на входе и восстановлении, композиция сохранена', async ({ page }, info) => {
  for (const percent of phase === 'before' ? [100] : [100, 200]) {
    for (const [name, route] of [
      ['sign-in', '/sign-in'],
      ['forgot-password', '/forgot-password'],
      ['reset-missing', '/reset-password'],
    ]) {
      await page.goto(`#${route}`);
      await expect(page.locator('h1')).toBeVisible();
      await page.evaluate((p) => {
        document.documentElement.style.fontSize = `${p}%`;
      }, percent);
      await expect
        .poll(async () =>
          page.locator('h1').evaluate((element) => getComputedStyle(element).fontFamily),
        )
        .toContain('Onest');
      await capture(page, info, `auth-${name}-${percent}`);
    }
  }
});
