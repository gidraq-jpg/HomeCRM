import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { plain } from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { seedMeter, seedReading } from './meters-support.ts';
import { apiAs, expectNothingStored, openAs } from './notes-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// «Коммуналка за месяц» и аналитика объекта (R1a.9b): UTIL-11, UTIL-12. Семья вымышленная:
// Борис — взрослый, Вера — ребёнок. Объекты, счета, начисления и оплаты заводятся через API.

const TODAY = Number(homeDate(0).slice(8));
const END_DAY = TODAY <= 24 ? TODAY + 4 : TODAY;
const READING_RULE = {
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: TODAY, endDay: END_DAY },
};
const MONTH = homeDate(0).slice(0, 7);
const YEAR = Number(MONTH.slice(0, 4));
const MM = MONTH.slice(5, 7);

async function setup(family: Family) {
  await setHomeZone(family);
  const boris = await apiAs(family, 'adult');
  const flat = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    typeData: { status: 'living' },
  });
  const dacha = await seedProperty(boris, family, {
    title: 'Дача у озера',
    audience: 'adults',
    typeData: { status: 'rented' },
  });
  const electricity = await seedAccount(boris, flat.id, {
    title: 'Электроэнергия',
    data: { number: 'TEST-777', readingRule: READING_RULE },
  });
  await seedAccount(boris, flat.id, {
    title: 'Газ',
    data: { number: 'TEST-888', readingRule: READING_RULE, transmission: { method: 'automatic' } },
  });
  return { boris, flat, dacha, electricity };
}

async function charge(
  boris: Awaited<ReturnType<typeof apiAs>>,
  family: Family,
  accountId: string,
  period: string,
  totalCents: number,
  paid: { paidOn: string; amountCents: number },
) {
  const created = await boris.post(`accounts/${accountId}/charges`, {
    period,
    totalCents,
    dueOn: homeDate(10),
  });
  if (created.status !== 201) throw new Error(`Test charge was not created: ${created.status}`);
  const id = (created.body as { id: string }).id;
  const payment = await boris.post(`charges/${id}/payments`, {
    ...paid,
    payer: { kind: 'member', accountId: family.person('adult').id },
    method: 'card',
  });
  if (payment.status !== 201) throw new Error(`Test payment was not created: ${payment.status}`);
}

async function openMonth(page: Page) {
  await page.goto('#/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Коммуналка за месяц' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Коммуналка за месяц', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Загружаем месяц…')).toHaveCount(0);
}

const objectCard = (page: Page, title: string) =>
  page.getByRole('listitem', { name: `Объект: ${title}`, exact: true });

test('месяц с частичной оплатой: суммы, статусы показаний, переключатель и пустой месяц', async ({
  page,
  family,
}, info) => {
  const { boris, flat, electricity } = await setup(family);
  await charge(boris, family, electricity.id, MONTH, 184_050, {
    paidOn: homeDate(0),
    amountCents: 40_000,
  });
  await signInAs(page, family, 'adult');
  await openMonth(page);

  // Итого и по объекту: начислено 1 840,50 ₽, оплачено 400 ₽, к оплате 1 440,50 ₽.
  const totals = page.locator('section.section').filter({
    has: page.getByRole('heading', { level: 2, name: 'Всего', exact: true }),
  });
  await expect(totals).toContainText(/Начислено\s*1\s840,50\s₽/);
  await expect(totals).toContainText(/Оплачено\s*400\s₽/);
  await expect(totals).toContainText(/К оплате\s*1\s440,50\s₽/);
  const flatCard = objectCard(page, 'Квартира у парка');
  await expect(flatCard).toContainText(/К оплате\s*1\s440,50\s₽/);
  await expect(flatCard.getByText('Показания не переданы', { exact: true })).toBeVisible();
  await expect(flatCard.getByText('Передача не требуется', { exact: true })).toBeVisible();
  // Дача без лицевых счетов: нулевые суммы и действие.
  const dachaCard = objectCard(page, 'Дача у озера');
  await expect(dachaCard).toContainText(/Начислено\s*0\s₽/);
  await expect(dachaCard.getByRole('link', { name: 'Добавить лицевой счёт' })).toBeVisible();

  // Переходы к «Показаниям» и «Начислениям» ведут в нужный объект и счёт.
  await expect(flatCard.getByRole('link', { name: 'Показания: Электроэнергия' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/readings`,
  );
  await expect(flatCard.getByRole('link', { name: 'Начисления: Электроэнергия' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/accounts/${electricity.id}/charges`,
  );
  await checkApp(page, info, 'month');

  // Следующий месяц: окно ещё не открылось, начислений нет — понятный текст и действие.
  await page.getByRole('button', { name: 'Следующий месяц' }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(page.getByText('Загружаем месяц…')).toHaveCount(0);
  await expect(page.getByRole('region', { name: /начислений нет/ })).toBeVisible();
  await expect(
    objectCard(page, 'Квартира у парка').getByText('Окно показаний ещё не открылось', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Добавить начисление' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/accounts/${electricity.id}/charges`,
  );
  await checkApp(page, info, 'month-empty');

  // Назад к текущему месяцу: суммы на месте. Суммы не лежат в адресе и хранилищах.
  await page.getByRole('button', { name: 'К текущему месяцу' }).click();
  await expect(totals).toContainText(/К оплате\s*1\s440,50\s₽/);
  await expectNothingStored(page, ['TEST-777', 'Квартира у парка', '184050', '1 840,50']);
});

test('аналитика: диаграммы, таблица-дублёр и сравнение с прошлым годом; расход строкой', async ({
  page,
  family,
}, info) => {
  const { boris, flat, electricity } = await setup(family);
  await charge(boris, family, electricity.id, MONTH, 184_050, {
    paidOn: homeDate(0),
    amountCents: 40_000,
  });
  await charge(boris, family, electricity.id, `${YEAR - 1}-${MM}`, 120_000, {
    paidOn: `${YEAR - 1}-${MM}-20`,
    amountCents: 120_000,
  });
  // Расход: 30 единиц в этом месяце прошлого года и 60 — в этом.
  const meter = await seedMeter(boris, flat.id, {
    title: 'Электросчётчик',
    utilityAccountId: electricity.id,
    data: { resource: 'electricity' },
    initial: { occurredOn: `${YEAR - 1}-${MM}-01`, values: ['100.000'] },
  });
  await seedReading(boris, meter.id, `${YEAR - 1}-${MM}-15`, ['130.000']);
  await seedReading(boris, meter.id, `${MONTH}-01`, ['190.000']);

  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${flat.id}`);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  const block = page.locator('section.section').filter({
    has: page.getByRole('heading', { level: 2, name: 'Аналитика', exact: true }),
  });
  await expect(block.getByText('Загружаем аналитику…')).toHaveCount(0);
  await expect(block.getByRole('img', { name: /Начислено и оплачено по месяцам/ })).toBeVisible();
  await expect(block.getByRole('img', { name: /Расход, Электроэнергия/ })).toBeVisible();
  await expect(block.getByRole('list', { name: 'Обозначения' }).first()).toContainText('Начислено');

  // Таблица-дублёр для экранного диктора: точные суммы и расход строкой, как пришёл.
  await block.getByText('Таблицы с точными значениями').click();
  const money = block.getByRole('table', { name: 'Начислено и оплачено по месяцам' });
  await expect(money.getByRole('row')).toHaveCount(13);
  const current = money.getByRole('row').last();
  expect(plain(await current.innerText())).toMatch(/1 840,50 ₽\s*400 ₽$/);
  const comparison = block.getByRole('table', { name: /^Сравнение:/ });
  const consumption = comparison.getByRole('row').filter({ hasText: 'Электроэнергия' });
  expect(plain(await consumption.innerText())).toMatch(/60,000\s+30,000/);
  await expect(comparison.getByRole('row').filter({ hasText: 'Начислено' })).toContainText(
    /1\s840,50\s₽\s*1\s200\s₽/,
  );
  await checkApp(page, info, 'analytics');
  await expectNothingStored(page, ['TEST-777', 'Квартира у парка', '184050']);
});

test('ребёнок не видит сумм объекта «Взрослые», его начислений и аналитики', async ({
  page,
  family,
  browser,
}, info) => {
  const { boris, flat, electricity } = await setup(family);
  await charge(boris, family, electricity.id, MONTH, 184_050, {
    paidOn: homeDate(0),
    amountCents: 40_000,
  });
  await signInAs(page, family, 'adult');
  await openMonth(page);
  await expect(objectCard(page, 'Квартира у парка')).toBeVisible();

  const vera = await openAs(browser, family, info, 'child');
  try {
    const api = await apiAs(family, 'child');
    const month = (await api.get(`utilities/month?month=${MONTH}`)).body as {
      objects: unknown[];
      totals: { chargedCents: number };
    };
    expect(month.objects).toEqual([]);
    expect(month.totals.chargedCents).toBe(0);
    expect((await api.get(`objects/${flat.id}/analytics`)).status).toBe(404);

    await vera.page.goto('#/home/month');
    await expect(vera.page.getByText('Загружаем месяц…')).toHaveCount(0);
    await expect(vera.page.getByRole('region', { name: 'Объектов пока нет' })).toBeVisible();
    await expect(vera.page.getByText(/840,50/)).toHaveCount(0);
    await expect(vera.page.getByText('Квартира у парка')).toHaveCount(0);
    await checkApp(vera.page, info, 'month-child');
  } finally {
    await vera.close();
  }
});
