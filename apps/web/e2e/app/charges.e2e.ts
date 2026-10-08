import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import { plain } from '../support/helpers.ts';
import { homeDate, openRadar, recalc, setHomeZone } from './deadlines-support.ts';
import { makePng } from './files-support.ts';
import { apiAs, expectNothingStored, openAs } from './notes-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Начисления и оплаты (R1a.7b): UTIL-9, UTIL-10, DEAD-4. Семья вымышленная: Борис — взрослый,
// Вера — ребёнок. Объект и лицевой счёт заводятся через API, всё остальное — экранами.

const toast = (page: Page) => page.locator('.toast-region');
const TODAY = Number(homeDate(0).slice(8));
const PAYMENT_RULE = {
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: TODAY },
};
const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];
/** Расчётный месяц нового начисления — предыдущий от сегодняшнего: «Сентябрь 2026». */
const PERIOD = (() => {
  const [year = 0, month = 1] = homeDate(0).split('-').map(Number);
  return month === 1 ? `${MONTHS[11]} ${year - 1}` : `${MONTHS[month - 2]} ${year}`;
})();

async function setup(family: Parameters<typeof setHomeZone>[0]) {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const flat = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    typeData: { status: 'living' },
  });
  const account = await seedAccount(boris, flat.id, {
    title: 'Электроэнергия',
    data: { number: 'TEST-777', paymentRule: PAYMENT_RULE },
  });
  return { boris, flat, account };
}

const chargeCard = (page: Page) => page.getByRole('listitem', { name: `Начисление: ${PERIOD}` });

async function addCharge(page: Page, flatId: string) {
  await page.goto('#/more');
  await page.goto(`#/home/${flatId}/accounts`);
  await page.getByRole('link', { name: 'Начисления и оплаты' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Начисления: Электроэнергия' }),
  ).toBeVisible();
}

test('начисление с перерасчётом и квитанцией; суммы уходят целыми копейками', async ({
  page,
  family,
}, info) => {
  const { flat } = await setup(family);
  await signInAs(page, family, 'adult');
  await addCharge(page, flat.id);
  await expect(page.getByRole('region', { name: 'Начислений пока нет' })).toBeVisible();
  await checkApp(page, info, 'charges-empty');
  await page.getByRole('button', { name: 'Добавить начисление' }).click();

  const form = page.locator('form.charge-form');
  await form.getByRole('button', { name: 'Добавить строку' }).click();
  await form
    .getByRole('group', { name: 'Строка 1' })
    .getByLabel('Название')
    .fill('Электроэнергия день');
  await form.getByRole('group', { name: 'Строка 1' }).getByLabel('Сумма, ₽').fill('1 840,50');
  await form.getByRole('button', { name: 'Добавить строку' }).click();
  await form.getByRole('group', { name: 'Строка 2' }).getByLabel('Название').fill('Водоотведение');
  await form.getByRole('group', { name: 'Строка 2' }).getByLabel('Сумма, ₽').fill('0,29');
  await form.getByRole('button', { name: 'Добавить перерасчёт' }).click();
  const adjustment = form.getByRole('group', { name: 'Перерасчёт 3' });
  await adjustment.getByLabel('Название').fill('Корректировка прошлого месяца');
  await adjustment.getByLabel('Сумма со знаком, ₽').fill('-100,10');
  // Итог считается сам: 1 840,50 + 0,29 − 100,10.
  await expect(form.locator('.charge-total')).toHaveText(/1\s740,69\s₽/);

  // Квитанция: загружается тут же и выбирается в списке.
  await form
    .locator('input[type="file"]')
    .setInputFiles({ name: 'kvitancia.png', mimeType: 'image/png', buffer: makePng(64, 64) });
  await expect(form.getByLabel('Квитанция', { exact: true })).toHaveValue(/.+/);
  await checkApp(page, info, 'charge-form');

  const request = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/api\/accounts\/[^/]+\/charges$/.test(r.url()),
  );
  await form.getByRole('button', { name: 'Сохранить начисление' }).click();
  const body = (await request).postDataJSON() as {
    totalCents: number;
    lines: { amountCents: number; kind: string }[];
  };
  expect(body.totalCents).toBe(174_069);
  expect(body.lines.map((line) => line.amountCents)).toEqual([184_050, 29, -10_010]);
  expect(body.lines.map((line) => line.kind)).toEqual(['service', 'service', 'adjustment']);
  await expect(toast(page)).toContainText('Начисление сохранено');

  const card = chargeCard(page);
  await expect(card.getByText('К оплате', { exact: true })).toBeVisible();
  await expect(card.getByRole('list', { name: /Строки начисления/ })).toContainText('перерасчёт');
  expect(plain(await card.getByRole('listitem').nth(2).innerText())).toContain('−100,10 ₽');
  await expect(card.getByRole('link', { name: /Квитанция: / })).toBeVisible();
  await checkApp(page, info, 'charge-card');

  // Итог одним числом, без строк: «1 840,50» → 184050 копеек.
  await page.getByRole('button', { name: 'Добавить начисление' }).click();
  const second = page.locator('form.charge-form');
  await second.getByLabel('Расчётный месяц').fill('2026-01');
  await second.getByLabel('Итог, ₽').fill('1 840,50');
  const request2 = page.waitForRequest(
    (r) => r.method() === 'POST' && /\/api\/accounts\/[^/]+\/charges$/.test(r.url()),
  );
  await second.getByRole('button', { name: 'Сохранить начисление' }).click();
  const body2 = (await request2).postDataJSON() as { totalCents: number; lines?: unknown };
  expect(body2.totalCents).toBe(184_050);
  expect(body2.lines).toBeUndefined();
  await expect(page.getByRole('listitem', { name: 'Начисление: Январь 2026' })).toBeVisible();

  const stored = await family.database.admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM utility_charges',
  );
  expect(stored.rows[0]?.n).toBe(2);
  await expectNothingStored(page, ['TEST-777', 'Квартира у парка', 'Электроэнергия день', '1740']);
});

test('две оплаты закрывают срок в радаре, отмена с причиной открывает его, ребёнок ничего не видит', async ({
  page,
  family,
  browser,
}, info) => {
  const { flat, account } = await setup(family);
  await signInAs(page, family, 'adult');
  await addCharge(page, flat.id);
  await page.getByRole('button', { name: 'Добавить начисление' }).click();
  const form = page.locator('form.charge-form');
  await form.getByLabel('Итог, ₽').fill('1 000,15');
  await form.getByRole('button', { name: 'Сохранить начисление' }).click();
  await expect(toast(page)).toContainText('Начисление сохранено');
  await recalc(family);

  // Срок оплаты начисления сегодня: в радаре, «Открыть счёт» ведёт к начислениям.
  const radarPayment = () =>
    page
      .getByRole('list', { name: 'Сейчас', exact: true })
      .getByRole('listitem')
      .filter({ hasText: 'Оплата' });
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(radarPayment()).toHaveCount(1);
  await expect(radarPayment().getByRole('link', { name: 'Открыть счёт' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/accounts/${account.id}/charges`,
  );
  await checkApp(page, info, 'charges-radar');

  // Первая оплата — частично: срок остаётся.
  await addCharge(page, flat.id);
  const card = chargeCard(page);
  await card.getByRole('button', { name: 'Добавить оплату' }).click();
  const sheet = page.getByRole('dialog', { name: 'Оплата' });
  await expect(sheet.getByLabel('Дата оплаты')).toHaveValue(homeDate(0));
  await expect(sheet.getByLabel('Сумма, ₽')).toHaveValue('1000,15');
  await sheet.getByLabel('Сумма, ₽').fill('400');
  await expect(sheet.getByLabel('Кто заплатил')).toHaveValue('me');
  await checkApp(page, info, 'payment-sheet');
  await sheet.getByRole('button', { name: 'Сохранить оплату' }).click();
  await expect(toast(page)).toContainText('Оплата сохранена');
  await expect(
    card.locator('.charge-card__status').getByText('Частично', { exact: true }),
  ).toBeVisible();
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(radarPayment()).toHaveCount(1);

  // Вторая оплата — на остаток: срок закрыт.
  await addCharge(page, flat.id);
  await chargeCard(page).getByRole('button', { name: 'Добавить оплату' }).click();
  const second = page.getByRole('dialog', { name: 'Оплата' });
  await expect(second.getByLabel('Сумма, ₽')).toHaveValue('600,15');
  await second.getByLabel('Способ оплаты').selectOption('cash');
  await second.getByRole('button', { name: 'Сохранить оплату' }).click();
  await expect(
    chargeCard(page).locator('.charge-card__status').getByText('Оплачено', { exact: true }),
  ).toBeVisible();
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(radarPayment()).toHaveCount(0);

  // Отмена первой оплаты требует причины и снова открывает срок; оплата остаётся зачёркнутой.
  await addCharge(page, flat.id);
  await chargeCard(page).getByRole('button', { name: 'Оплаты' }).click();
  const payments = page.getByRole('list', { name: `Оплаты: ${PERIOD}` });
  await expect(payments.getByRole('listitem')).toHaveCount(2);
  await payments.getByRole('button', { name: /^Отменить оплату 400/ }).click();
  const cancel = page.getByRole('dialog', { name: 'Отменить оплату' });
  await cancel.getByRole('button', { name: 'Отменить оплату' }).click();
  await expect(cancel.getByRole('alert')).toContainText('Напишите причину');
  await cancel.getByLabel('Причина').fill('Ошибочная сумма');
  await checkApp(page, info, 'payment-cancel-sheet');
  await cancel.getByRole('button', { name: 'Отменить оплату' }).click();
  await expect(toast(page)).toContainText('Оплата отменена');
  const cancelled = payments.getByRole('listitem').filter({ hasText: 'Отменена' });
  await expect(cancelled).toContainText('Причина отмены: Ошибочная сумма');
  await expect(cancelled.locator('del')).toBeVisible();
  await expect(
    chargeCard(page).locator('.charge-card__status').getByText('Частично', { exact: true }),
  ).toBeVisible();
  await checkApp(page, info, 'payment-cancelled');
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(radarPayment()).toHaveCount(1);

  // «Отметить оплату» в радаре создаёт оплату на остаток, «Отменить» в уведомлении — отменяет её.
  await radarPayment().getByRole('button', { name: 'Отметить оплату' }).click();
  await expect(toast(page)).toContainText('Оплата отмечена');
  await expect(radarPayment()).toHaveCount(0);
  const live = await family.database.admin.query<{ n: number; total: string }>(
    'SELECT count(*)::int AS n, coalesce(sum(amount_cents),0)::text AS total FROM utility_payments WHERE cancelled_at IS NULL',
  );
  expect(live.rows[0]).toEqual({ n: 2, total: '100015' });
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(radarPayment()).toHaveCount(1);
  const reasons = await family.database.admin.query<{ reason: string }>(
    'SELECT cancellation_reason AS reason FROM utility_payments WHERE cancelled_at IS NOT NULL',
  );
  expect(reasons.rows.map((row) => row.reason).sort()).toEqual(
    ['Ошибочная сумма', 'Отметка снята сразу после создания'].sort(),
  );
  await expectNothingStored(page, ['TEST-777', 'Квартира у парка', 'Ошибочная сумма', '1000,15']);

  // Ребёнок не видит ни объект «Взрослые», ни его начисления и оплаты.
  const charges = (await (await apiAs(family, 'adult')).get(`accounts/${account.id}/charges`))
    .body as { id: string }[];
  const chargeId = charges[0]?.id ?? '';
  const vera = await openAs(browser, family, info, 'child');
  try {
    const api = await apiAs(family, 'child');
    for (const path of [
      `accounts/${account.id}/charges`,
      `charges/${chargeId}`,
      `charges/${chargeId}/payments`,
    ]) {
      expect((await api.get(path)).status, path).toBe(404);
    }
    await vera.page.goto(`#/home/${flat.id}/accounts/${account.id}/charges`);
    await expect(vera.page.getByText('Объекта больше нет')).toBeVisible();
    await expect(vera.page.getByText('Электроэнергия')).toHaveCount(0);
    await checkApp(vera.page, info, 'charges-child');
  } finally {
    await vera.close();
  }
});
