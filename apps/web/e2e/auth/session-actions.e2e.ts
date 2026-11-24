import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures.ts';
import { checkAuth, expectSignedIn, signIn, trackApi } from './support/helpers.ts';

test('отзыв текущей сессии возвращает на вход', async ({ page, family }) => {
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Завершить сессию' }).click();
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
});

test('взрослый выключает TOTP с повторным вводом пароля', async ({ page, family }) => {
  const enrollment = await family.enroll('adult');
  const apiIdle = trackApi(page);
  await signIn(page, family, 'adult');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).click();
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('adult').password);
  // Выключение меняет сессию. Фоновая подгрузка разделов стартует через 300 мс после входа и
  // попадала на этот момент: её запрос со старой сессией получал 401 и возвращал на вход.
  await apiIdle();
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).last().click();
  await expect(page.getByText('Второй фактор пока не включён.', { exact: false })).toBeVisible();
});

/** Cookie браузера для запроса «с другого устройства» с той же сессией. */
async function cookieHeader(page: Page) {
  return (await page.context().cookies())
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

/** Ответ сервера, полученный вне браузера, отдаётся браузеру как есть, вместе с Set-Cookie. */
async function forward(response: Response) {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie' && key !== 'content-length' && key !== 'content-encoding')
      headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
  return { status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) };
}

/** Отмечает в окне, появлялся ли экран входа хотя бы на миг. */
async function watchSignInScreen(page: Page) {
  await page.evaluate(() => {
    const flags = window as Window & { sawSignIn?: boolean };
    flags.sawSignIn = false;
    const check = () => {
      for (const heading of document.querySelectorAll('h1, h2'))
        if (heading.textContent?.includes('Войти в HomeCRM')) flags.sawSignIn = true;
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
  });
}

test('выключение TOTP при фоновом запросе со старой сессией: участник остаётся в приложении (D58)', async ({
  page,
  family,
}, info) => {
  const enrollment = await family.enroll('adult');
  const apiIdle = trackApi(page);
  await signIn(page, family, 'adult');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await apiIdle();
  const oldCookie = await cookieHeader(page);
  const signal = () => {
    let done!: () => void;
    const promise = new Promise<void>((resolve) => {
      done = resolve;
    });
    return { promise, done };
  };
  const rotated = signal();
  const disableAnswered = signal();
  /**
   * Первый запрос по адресу ждёт сигнала и уходит на сервер со старой cookie, уже после смены
   * сессии: браузер получает настоящий ответ 401. Остальные запросы идут как обычно.
   */
  const staleOnce = async (pattern: string, release: Promise<void>) => {
    const answered = signal();
    let held = false;
    await page.route(pattern, async (route) => {
      if (held) return route.continue();
      held = true;
      await release;
      try {
        const url = new URL(route.request().url());
        const response = await fetch(`${family.origin}${url.pathname}${url.search}`, {
          headers: { cookie: oldCookie },
        });
        expect(response.status, 'запрос со старой сессией получает настоящий 401').toBe(401);
        await route.fulfill(await forward(response));
      } finally {
        answered.done();
      }
    });
    return { answered: answered.promise };
  };
  // Журнал входов (запрос экрана) отвечает раньше ответа о смене сессии, ещё один фоновый
  // запрос страницы — позже него. Второй никто не отменяет, поэтому его ответ всегда доходит.
  const early = await staleOnce('**/api/login-events**', rotated.promise);
  const late = await staleOnce('**/api/me?d58-late', disableAnswered.promise);
  await page.goto('#/more/settings');
  await expect(page.getByText('Загружаем журнал…')).toBeVisible();
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).click();
  await page
    .getByLabel('Подтвердите пароль', { exact: true })
    .fill(family.person('adult').password);
  await watchSignInScreen(page);
  await page.evaluate(() => {
    void fetch('/api/me?d58-late', { credentials: 'same-origin', cache: 'no-store' });
  });
  await page.route('**/api/auth/two-factor/disable', async (route) => {
    // Сервер выключает второй фактор и удаляет старую сессию, а браузер ещё не знает новую cookie.
    const response = await family.post(
      'auth/two-factor/disable',
      route.request().postDataJSON(),
      oldCookie,
    );
    expect(response.status).toBe(200);
    rotated.done();
    await early.answered;
    // До исправления клиент сразу перепроверял «кто я» со старой cookie. После исправления он
    // ждёт ответа о смене сессии, и окно просто истекает.
    await page
      .waitForResponse((reply) => new URL(reply.url()).pathname === '/api/auth/get-session', {
        timeout: 2000,
      })
      .catch(() => undefined);
    await route.fulfill(await forward(response));
    // Запоздавший 401 приходит уже после новой cookie: до исправления сервера он её стирал.
    disableAnswered.done();
    await late.answered;
  });
  await page.getByRole('button', { name: 'Выключить второй фактор', exact: true }).last().click();
  await expect(page.getByText('Второй фактор пока не включён.', { exact: false })).toBeVisible();
  // Журнал и устройства после смены сессии перечитаны с новой cookie.
  await expect(page.getByRole('heading', { name: 'Журнал входов' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить загрузку журнала' })).toHaveCount(0);
  await expect(page.getByText('Загружаем журнал…')).toHaveCount(0);
  await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить загрузку устройств' })).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { sawSignIn?: boolean }).sawSignIn),
    'экран входа не появлялся',
  ).toBe(false);
  await checkAuth(page, info, 'settings-after-totp-off', 'app');
});

test('настоящий 401: сессию завершили на другом устройстве — экран входа (D58)', async ({
  page,
  family,
}, info) => {
  const apiIdle = trackApi(page);
  await signIn(page, family, 'child');
  await expectSignedIn(page);
  await apiIdle();
  // «Выйти на всех устройствах» с другого устройства: сессии этого браузера больше нет.
  const revoked = await family.post('auth/revoke-sessions', {}, await cookieHeader(page));
  expect(revoked.status).toBe(200);
  await page.goto('#/more/settings');
  // Каждый 401 экрана заново сбрасывает данные; проверка «кто я» при этом не отменяется.
  await expect(page.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  await checkAuth(page, info, 'session-revoked-elsewhere');
});

test('администратор приглашает ребёнка: из настроек — к экрану «Люди»', async ({
  page,
  family,
}, info) => {
  const enrollment = await family.enroll('admin');
  await signIn(page, family, 'admin');
  await page.getByRole('button', { name: 'Использовать резервный код' }).click();
  await page.getByLabel('Резервный код', { exact: true }).fill(enrollment.backupCodes[0] ?? '');
  await page.getByRole('button', { name: 'Подтвердить вход' }).click();
  await expectSignedIn(page);
  await page.goto('#/more/settings');
  await expect(page.getByRole('button', { name: 'Выключить второй фактор' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Пригласить участника' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Пригласить участника' })).toBeVisible();
  await page.getByRole('radio', { name: /Ребёнок/ }).check();
  await page.getByRole('button', { name: 'Создать ссылку-приглашение' }).click();
  await expect(page.getByTestId('issued-link')).toContainText('/invite/');
  await checkAuth(page, info, 'invite-admin');
  const { rows } = await family.database.admin.query('SELECT role FROM invitations');
  expect(rows.map((row: { role: string }) => row.role)).toEqual(['child']);
});

test('устройства без токенов: текущее отмечено, другое отзывается по id', async ({
  page,
  family,
  browser,
}, info) => {
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  try {
    await otherPage.goto(family.baseURL);
    await signIn(otherPage, family, 'child');
    await expectSignedIn(otherPage);
    await signIn(page, family, 'child');
    await expectSignedIn(page);
    const response = page.waitForResponse('**/api/auth/list-sessions');
    await page.goto('#/more/settings');
    const list = (await (await response).json()) as Array<{ id: string; current: boolean }>;
    expect(list).toHaveLength(2);
    for (const session of list) {
      expect(Object.keys(session).sort()).toEqual(
        ['id', 'userAgent', 'ipAddress', 'createdAt', 'updatedAt', 'expiresAt', 'current'].sort(),
      );
    }
    await expect(page.getByText('Это устройство', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(2);
    await checkAuth(page, info, 'session-devices');
    const otherRow = page.locator('.security-list li').filter({
      has: page.getByRole('button', { name: 'Завершить сессию' }),
      hasNotText: 'Это устройство',
    });
    const revoke = page.waitForRequest('**/api/auth/revoke-session');
    await otherRow.getByRole('button', { name: 'Завершить сессию' }).click();
    expect((await revoke).postDataJSON()).toEqual({
      id: list.find((session) => !session.current)?.id,
    });
    await expect(page.getByRole('button', { name: 'Завершить сессию' })).toHaveCount(1);
    await expect(page.getByText('Это устройство', { exact: true })).toBeVisible();
    await otherPage.reload();
    await expect(otherPage.getByRole('heading', { name: 'Войти в HomeCRM' })).toBeVisible();
  } finally {
    await other.close();
  }
});
