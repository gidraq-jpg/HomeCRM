import type { Page } from '@playwright/test';
import { type DateOnly, formatShortDate } from '../../src/ui/format.ts';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { homeDate, openRadar, recalc, setHomeZone } from './deadlines-support.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs, expectNothingStored } from './notes-support.ts';
import { openNotifications } from './notifications-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Сроки коммуналки в радаре и на «Сегодня» (R1a.6b): UTIL-7, UTIL-13, DEAD-3…5, NOTIF-3, NOTIF-4.
// Семья вымышленная: Анна — администратор, Борис — взрослый, Вера — ребёнок. Объекты, счета и
// счётчики заводятся через API, пересчёт наступлений вызывается вручную (обработчика в тесте нет).

const toast = (page: Page) => page.locator('.toast-region');
const group = (page: Page, name: string) =>
  page.getByRole('list', { name, exact: true }).getByRole('listitem');

/** Сегодняшний день месяца в часовом поясе дома. */
const TODAY = Number(homeDate(0).slice(8));
/** Окно показаний, открытое сегодня: с сегодняшнего дня на несколько дней (в конце месяца — на день). */
const END_DAY = TODAY <= 24 ? TODAY + 4 : TODAY;
const READING_RULE = {
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: TODAY, endDay: END_DAY },
};
const PAYMENT_RULE = {
  kind: 'repeat',
  anchor: '2026-01-01',
  repeat: { unit: 'month', day: TODAY },
};

async function family3(family: Family) {
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
    data: { number: 'TEST-123', readingRule: READING_RULE, paymentRule: PAYMENT_RULE },
  });
  await seedMeter(boris, flat.id, {
    title: 'Электросчётчик',
    utilityAccountId: electricity.id,
    data: { resource: 'electricity', nextVerificationOn: homeDate(5) },
    initial: { occurredOn: homeDate(-40), values: ['100.000'] },
  });
  // У дачи счётчиков нет: окно напоминает с подсказкой «Добавьте счётчики».
  await seedAccount(boris, dacha.id, {
    title: 'Вода',
    data: { number: 'TEST-456', readingRule: READING_RULE },
  });
  await recalc(family);
  return { boris, flat, dacha, electricity };
}

test('«Сегодня»: карточки открытых окон по объектам «Живём» и «Сдаётся»; «Передано» для окна без счётчиков', async ({
  page,
  family,
}, info) => {
  const { flat, dacha } = await family3(family);
  await signInAs(page, family, 'adult');
  const windows = page.getByRole('list', { name: 'Открытые окна показаний' });
  await expect(windows.getByRole('listitem')).toHaveCount(2);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Открыто окно показаний' }),
  ).toBeVisible();

  // Название объекта крупно и первым, статус рядом; потом конец окна и сколько счётчиков без показаний.
  const flatCard = windows.getByRole('listitem').filter({ hasText: 'Квартира у парка' });
  await expect(flatCard.getByRole('heading', { level: 3 })).toHaveText('Квартира у парка');
  await expect(flatCard).toContainText('Живём');
  await expect(flatCard).toContainText(
    `до ${formatShortDate(homeDate(END_DAY - TODAY) as DateOnly)}`,
  );
  await expect(flatCard).toContainText('1 счётчик без показаний');
  const dachaCard = windows.getByRole('listitem').filter({ hasText: 'Дача у озера' });
  await expect(dachaCard.getByRole('heading', { level: 3 })).toHaveText('Дача у озера');
  await expect(dachaCard).toContainText('Сдаётся');
  await expect(dachaCard.getByRole('link', { name: 'Добавьте счётчики' })).toHaveAttribute(
    'href',
    `#/home/${dacha.id}/meters`,
  );
  await checkApp(page, info, 'utility-today-windows');

  // «Внести показания» ведёт на экран показаний этого объекта.
  await flatCard.getByRole('link', { name: 'Внести показания' }).click();
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}/readings$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();

  // «Другой объект» начинается с объектов с открытым окном.
  await page.getByRole('button', { name: 'Другой объект' }).click();
  const sheet = page.getByRole('dialog', { name: 'Другой объект' });
  await expect(sheet.getByText('Открыто окно показаний')).toBeVisible();
  await expect(sheet.getByRole('link', { name: /Дача у озера/ })).toBeVisible();
  await checkApp(page, info, 'utility-readings-switch');

  await page.keyboard.press('Escape');

  // «Передано»: окно без счётчиков закрывается ручной отметкой, отмена возвращает его.
  await page.goto('#/today');
  await expect(windows.getByRole('listitem')).toHaveCount(2);
  await windows
    .getByRole('listitem')
    .filter({ hasText: 'Дача у озера' })
    .getByRole('button', { name: 'Передано' })
    .click();
  await expect(toast(page)).toContainText('Окно отмечено как переданное');
  await expect(windows.getByRole('listitem')).toHaveCount(1);
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(windows.getByRole('listitem')).toHaveCount(2);
  await expectNothingStored(page, ['Квартира у парка', 'Дача у озера', 'TEST-123', 'TEST-456']);
});

test('радар: окно, оплата с отменой и поверка — объект первым, действия и «Открыть счёт»', async ({
  page,
  family,
}, info) => {
  const { flat, dacha, electricity } = await family3(family);
  await signInAs(page, family, 'adult');
  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();

  // Окно показаний: название объекта и статус первыми, затем лицевой счёт с номером.
  const now = group(page, 'Сейчас');
  const windowItem = now
    .filter({ hasText: 'Окно показаний' })
    .filter({ hasText: 'Квартира у парка' });
  await expect(windowItem).toContainText('Живём');
  await expect(windowItem).toContainText('Электроэнергия · № TEST-123');
  await expect(windowItem.getByRole('link', { name: 'Внести показания' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/readings`,
  );
  await expect(windowItem.getByRole('link', { name: 'Открыть счёт' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/accounts`,
  );
  // Управляемый срок не правится из радара.
  await expect(windowItem.getByRole('button', { name: /Править|Удалить|В корзину/ })).toHaveCount(
    0,
  );

  // Окно без счётчиков: подсказка и «Передано».
  const empty = now.filter({ hasText: 'Дача у озера' });
  await expect(empty).toContainText('Сдаётся');
  await expect(empty.getByRole('link', { name: 'Добавьте счётчики' })).toHaveAttribute(
    'href',
    `#/home/${dacha.id}/meters`,
  );
  await expect(empty.getByRole('button', { name: 'Передано' })).toBeVisible();

  // Оплата: отметка и отмена.
  const payment = now.filter({ hasText: 'Оплата' });
  await expect(payment).toHaveCount(1);
  await expect(payment).toContainText('Квартира у парка');
  await checkApp(page, info, 'utility-radar');
  await payment.getByRole('button', { name: 'Отметить оплату' }).click();
  await expect(toast(page)).toContainText('Оплата отмечена');
  await expect(now.filter({ hasText: 'Оплата' })).toHaveCount(0);
  const marked = await family.database.admin.query(
    "SELECT count(*)::int AS n FROM deadline_occurrences o JOIN deadlines d ON d.id = o.deadline_id WHERE d.source_kind = 'payment' AND o.completed_at IS NOT NULL",
  );
  expect(marked.rows).toEqual([{ n: 1 }]);
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(now.filter({ hasText: 'Оплата' })).toHaveCount(1);
  const unmarked = await family.database.admin.query(
    "SELECT count(*)::int AS n FROM deadline_occurrences o JOIN deadlines d ON d.id = o.deadline_id WHERE d.source_kind = 'payment' AND o.completed_at IS NOT NULL",
  );
  expect(unmarked.rows).toEqual([{ n: 0 }]);

  // Поверка: дата по умолчанию — сегодня, следующая — от интервала счётчика.
  const verification = group(page, '7 дней').filter({ hasText: 'Поверка счётчика' });
  await expect(verification).toContainText('Квартира у парка');
  await expect(verification).toContainText('Электросчётчик');
  await expect(verification.getByRole('link', { name: 'Открыть счётчик' })).toHaveAttribute(
    'href',
    `#/home/${flat.id}/meters`,
  );
  await verification.getByRole('button', { name: 'Поверка проведена' }).click();
  const sheet = page.getByRole('dialog', { name: 'Поверка проведена' });
  await expect(sheet.getByLabel('Дата поверки')).toHaveValue(homeDate(0));
  await expect(sheet.getByLabel('Следующая поверка')).not.toHaveValue('');
  await checkApp(page, info, 'utility-verify-sheet');

  await sheet.getByRole('button', { name: 'Отметить поверку' }).click();
  await expect(toast(page)).toContainText('Поверка отмечена');
  // Пересчёт наступлений делает обработчик сроков; в тесте его вызываем сами.
  await recalc(family);
  await page.reload();
  await expect(group(page, '7 дней').filter({ hasText: 'Поверка счётчика' })).toHaveCount(0);
  const meter = await family.database.admin.query(
    "SELECT data->>'verifiedOn' AS verified_on, data->>'nextVerificationOn' AS next FROM meters WHERE title = 'Электросчётчик'",
  );
  expect(meter.rows).toHaveLength(1);
  expect(meter.rows[0]).toMatchObject({ verified_on: homeDate(0) });
  expect((meter.rows[0] as { next: string }).next > homeDate(0)).toBe(true);

  // Окно с настоящими счётчиками «Передано» не закрывает: кнопки у него нет.
  await expect(windowItem.getByRole('button', { name: 'Передано' })).toHaveCount(0);
  expect(electricity.id).toBeTruthy();
});

test('ребёнок не видит коммунальные сроки объекта «Взрослые» ни в радаре, ни на «Сегодня»', async ({
  page,
  family,
}, info) => {
  const { boris } = await family3(family);
  // Общий объект «Вся семья» с окном: его ребёнок видит.
  const shared = await seedProperty(boris, family, {
    title: 'Семейный дом',
    audience: 'household',
    typeData: { status: 'living' },
  });
  await seedAccount(boris, shared.id, {
    title: 'Газ',
    data: { number: 'TEST-FAMILY', readingRule: READING_RULE },
  });
  await recalc(family);

  await signInAs(page, family, 'child');
  const windows = page.getByRole('list', { name: 'Открытые окна показаний' });
  await expect(windows.getByRole('listitem')).toHaveCount(1);
  await expect(windows).toContainText('Семейный дом');
  await expect(page.getByText('Квартира у парка')).toHaveCount(0);
  await expect(page.getByText('Дача у озера')).toHaveCount(0);
  await checkApp(page, info, 'utility-today-child');

  await openRadar(page);
  await page.getByRole('radio', { name: 'Весь дом', exact: true }).check();
  await expect(page.getByRole('main')).toContainText('Семейный дом');
  await expect(page.getByRole('main')).not.toContainText('Квартира у парка');
  await expect(page.getByRole('main')).not.toContainText('Дача у озера');
  await expect(page.getByRole('main')).not.toContainText('TEST-123');
  await checkApp(page, info, 'utility-radar-child');

  // «Другой объект» и список показаний тоже не называют чужие объекты.
  await page.goto('#/more/readings');
  await expect(page.getByRole('main')).toContainText('Семейный дом');
  await expect(page.getByRole('main')).not.toContainText('Квартира у парка');
});

test('уведомления: шесть коммунальных видов отдельными переключателями; нажатие ведёт на экран объекта', async ({
  page,
  family,
}, info) => {
  const { flat } = await family3(family);
  await signInAs(page, family, 'adult');
  await openNotifications(page);
  const kinds = [
    'Открылось окно показаний',
    'Окно закрывается завтра',
    'Последний день окна',
    'Оплата через 3 дня',
    'Оплата сегодня',
    'Подходит срок поверки',
  ];
  for (const kind of kinds)
    await expect(page.getByRole('checkbox', { name: new RegExp(kind) })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Сроки записей/ })).toBeChecked();
  await checkApp(page, info, 'utility-notification-kinds');

  await page.getByRole('checkbox', { name: /Оплата сегодня/ }).uncheck();
  await page.getByRole('checkbox', { name: /Последний день окна/ }).uncheck();
  await page.getByRole('button', { name: 'Сохранить настройки' }).click();
  await expect(toast(page)).toContainText('Настройки уведомлений сохранены');
  const stored = await family.database.admin.query(
    'SELECT enabled_kinds FROM notification_settings',
  );
  expect(stored.rows).toEqual([
    {
      enabled_kinds: [
        'deadline',
        'readings_open',
        'readings_closing',
        'payment_upcoming',
        'verification',
      ],
    },
  ]);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: /Оплата сегодня/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Оплата через 3 дня/ })).toBeChecked();

  // Push по виду уведомления открывает нужный экран объекта.
  await page.goto(`#/open/${flat.id}/readings`);
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}/readings$`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Квартира у парка', exact: true }),
  ).toBeVisible();
  await page.goto(`#/open/${flat.id}/meters`);
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}/meters$`));
  await page.goto(`#/open/${flat.id}/accounts`);
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}/accounts$`));
  await page.goto(`#/open/${flat.id}`);
  await expect(page).toHaveURL(new RegExp(`#/home/${flat.id}$`));
});
