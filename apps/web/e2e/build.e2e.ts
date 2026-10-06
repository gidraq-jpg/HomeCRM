import { expect, test } from './support/fixtures.ts';
import { goToSection, openApp, setScope, startAdd } from './support/helpers.ts';
import { E2E_PORT, E2E_PREFIX } from './support/static-server.ts';

// Сборка для телефона (задача 0.5): статические файлы работают из подпапки, без сервера
// приложения и без внешних запросов; маршруты живут в части адреса после «#».

const ORIGIN = `http://127.0.0.1:${E2E_PORT}`;

test('сборка открывается из заданной подпапки, корень сайта не нужен', async ({ page }) => {
  await openApp(page, '/today');
  expect(new URL(page.url()).pathname).toBe(E2E_PREFIX);

  const assets = await page.evaluate(() =>
    [...document.querySelectorAll('script[src], link[href]')].map(
      (node) => node.getAttribute('src') ?? node.getAttribute('href') ?? '',
    ),
  );
  expect(assets.length).toBeGreaterThan(1);
  for (const asset of assets) {
    // Значок вшит в страницу (data:), остальное — файлы рядом со страницей.
    expect(
      asset.startsWith(E2E_PREFIX) || asset.startsWith('./') || asset.startsWith('data:'),
      asset,
    ).toBe(true);
  }

  // Корень сайта сервер не отдаёт: если бы сборка ссылалась на «/assets/…», страница не открылась бы.
  const root = await page.request.get(`${ORIGIN}/`);
  expect(root.status()).toBe(404);
  const assetsAtRoot = await page.request.get(`${ORIGIN}/assets/`);
  expect(assetsAtRoot.status()).toBe(404);
});

test('все запросы страницы — к тому же серверу, внешних нет', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));

  await openApp(page, '/today');
  for (const section of ['Дом', 'Документы', 'Люди', 'Ещё', 'Сегодня']) {
    await goToSection(page, section);
  }
  await page.getByRole('link', { name: 'Поиск' }).click();
  await page.getByRole('searchbox', { name: 'Что найти' }).fill('дача');
  await expect(page.getByRole('heading', { level: 2, name: 'Дом' })).toBeVisible();

  const foreign = requested.filter((url) => {
    const { protocol, origin } = new URL(url);
    return protocol !== 'data:' && protocol !== 'blob:' && origin !== ORIGIN;
  });
  expect(foreign).toEqual([]);
  // Всё, что запрошено, лежит в подпапке.
  for (const url of requested.filter(
    (item) => item.startsWith(ORIGIN) && !new URL(item).pathname.startsWith('/api/'),
  )) {
    expect(new URL(url).pathname.startsWith(E2E_PREFIX), url).toBe(true);
  }
});

test('глубокая ссылка открывается сразу: маршруты — после «#»', async ({ page }) => {
  await page.goto('#/documents/doc-dacha-insurance');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страховка дачи');
  await page.goto('#/home/sadovaya/readings');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Показания');
  await page.goto('#/нет-такой-страницы');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Страница не найдена');
});

test('пустой адрес ведёт на «Сегодня»; кнопка «назад» работает', async ({ page }) => {
  await page.goto('');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сегодня');
  await goToSection(page, 'Дом');
  await goToSection(page, 'Документы');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Дом');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сегодня');
});

test('«Начать прототип заново» возвращает исходное состояние и «Всё»', async ({ page }) => {
  await openApp(page, '/more/notes');
  await startAdd(page, 'Заметка');
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Заголовок').fill('Лишняя заметка');
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await setScope(page, 'Личное');
  await expect(page.getByRole('link', { name: /Лишняя заметка/ })).toBeVisible();

  await goToSection(page, 'Ещё');
  await page.getByRole('button', { name: 'Начать прототип заново' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Начать прототип заново?' });
  await expect(confirm).toContainText('Переключатель вернётся на «Всё»');

  // «Отмена» ничего не стирает.
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Личное' })).toBeChecked();

  await page.getByRole('button', { name: 'Начать прототип заново' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Начать заново' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сегодня');
  await expect(page.getByRole('radio', { name: 'Всё', exact: true })).toBeChecked();
  await expect(page.getByRole('status')).toContainText('Прототип начат заново');
  await goToSection(page, 'Ещё');
  await expect(page.getByText('Сейчас видно: 4')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('homecrm.scope'))).toBeNull();

  await page.getByRole('link', { name: /Заметки/ }).click();
  await expect(page.getByRole('link', { name: /Лишняя заметка/ })).toHaveCount(0);
});

test('сделанное в прототипе переживает перезагрузку: дела, покупки, доступ', async ({ page }) => {
  await openApp(page, '/today');
  // Дело уходит в «Выполнено», поэтому нажимаем, а не ждём состояния «отмечено».
  await page.getByRole('checkbox', { name: 'Забрать посылку на почте' }).click();
  await expect(page.getByRole('status')).toContainText('Дело выполнено');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Забрать посылку на почте' })).toHaveCount(0);
  await page.getByRole('button', { name: /Выполнено · 2/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Забрать посылку на почте' })).toBeChecked();
});
