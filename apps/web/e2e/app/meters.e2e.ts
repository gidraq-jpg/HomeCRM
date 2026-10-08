import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { makePng } from './files-support.ts';
import { HISTORY, seedMeter, seedReading } from './meters-support.ts';
import { apiAs, expectNothingStored } from './notes-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Счётчики и показания (R1a.5b): UTIL-3…8, UTIL-14, OBJ-3, сценарий S3. Семья вымышленная:
// Анна — администратор, Борис — взрослый, Вера — ребёнок. Значения и номера выдуманные.

const toast = (page: Page) => page.locator('.toast-region');
const meterRegion = (page: Page, title: string) => page.getByRole('region', { name: title });

/** Сегодняшняя дата дома (Москва) в виде `YYYY-MM-DD`: так её показывает поле даты. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Квартира с лицевым счётом и четырьмя счётчиками: ХВС с историей, ГВС у границы разряда, двухтарифное электричество, ХВС на кухне. */
async function seedFlat(family: Family) {
  const boris = await apiAs(family, 'adult');
  const property = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    typeData: { kind: 'apartment', address: 'Вымышленный проспект, 1', status: 'living' },
  });
  const account = await seedAccount(boris, property.id, {
    title: 'Вода и свет',
    data: {
      services: ['water_sewerage', 'electricity'],
      number: 'TEST-777',
      transmission: { method: 'gosuslugi_dom' },
    },
  });
  const cold = await seedMeter(boris, property.id, {
    title: 'ХВС, санузел',
    utilityAccountId: account.id,
    data: {
      resource: 'cold_water',
      serialNumber: 'FICTION-12345',
      installationPlace: 'Санузел',
      verifiedOn: '2020-10-08',
    },
    initial: { occurredOn: HISTORY[0], values: ['100.000'] },
  });
  await seedReading(boris, cold.id, HISTORY[1], ['110.000']);
  await seedReading(boris, cold.id, HISTORY[2], ['120.000']);
  const hot = await seedMeter(boris, property.id, {
    title: 'ГВС, санузел',
    utilityAccountId: account.id,
    data: { resource: 'hot_water', serialNumber: 'FICTION-22222', installationPlace: 'Санузел' },
    initial: { occurredOn: HISTORY[2], values: ['99998.500'] },
  });
  const power = await seedMeter(boris, property.id, {
    title: 'Электроэнергия, коридор',
    utilityAccountId: account.id,
    data: {
      resource: 'electricity',
      serialNumber: 'FICTION-33333',
      installationPlace: 'Коридор',
      zones: ['День', 'Ночь'],
      integerDigits: 6,
      fractionDigits: 1,
    },
    initial: { occurredOn: HISTORY[2], values: ['1000.0', '500.0'] },
  });
  const kitchen = await seedMeter(boris, property.id, {
    title: 'ХВС, кухня',
    utilityAccountId: account.id,
    data: { resource: 'cold_water', serialNumber: 'FICTION-44444', installationPlace: 'Кухня' },
    initial: { occurredOn: HISTORY[2], values: ['50.000'] },
  });
  return { boris, property, account, cold, hot, power, kitchen };
}

async function openReadings(page: Page, objectId: string, title: string) {
  await page.goto('#/more');
  await page.goto(`#/home/${objectId}/readings`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем счётчики…')).toHaveCount(0);
}

async function pickProperty(page: Page, title: string) {
  await page.goto('#/more');
  await page.getByRole('link', { name: /^Показания/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Показания', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('list', { name: 'Недвижимость' })
    .getByRole('link', { name: new RegExp(title) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}

test('S3: четыре счётчика — одно «Сохранить всё» и одна «Отметить переданными»', async ({
  page,
  family,
}, info) => {
  test.setTimeout(240_000);
  const consoleTexts: string[] = [];
  page.on('console', (message) => consoleTexts.push(message.text()));
  const { boris, property, cold, hot, power, kitchen } = await seedFlat(family);
  const dacha = await seedProperty(boris, family, {
    title: 'Дача у реки',
    audience: 'adults',
    typeData: { kind: 'dacha_land', status: 'rented' },
  });
  await signInAs(page, family, 'adult');

  // 1. «Ещё → Показания» → выбор объекта: название объекта и статус крупно в заголовке.
  await pickProperty(page, 'Квартира у парка');
  await expect(page.locator('.page-heading').getByText('Живём')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Счётчики' }).getByRole('listitem')).toHaveCount(4);
  await expect(meterRegion(page, 'ХВС, санузел')).toContainText('120,000');
  await expect(meterRegion(page, 'ХВС, санузел')).toContainText('№ FICTION-12345');
  await checkApp(page, info, 'readings-empty');

  // 2. Ошибки у поля: не число, меньше прошлого — с выбором «переход через ноль» или «замена».
  const kitchenBox = meterRegion(page, 'ХВС, кухня');
  const kitchenField = kitchenBox.getByLabel('Новое значение, м³');
  await kitchenField.fill('много');
  await expect(kitchenBox.getByRole('alert')).toContainText('Введите число');
  await kitchenField.fill('45');
  await expect(kitchenBox.getByRole('alert')).toHaveText('Меньше прошлого: 50,000');
  await expect(kitchenBox.getByRole('checkbox', { name: 'Переход через ноль' })).toBeVisible();
  await expect(kitchenBox.getByRole('button', { name: 'Замена счётчика' })).toBeVisible();
  await checkApp(page, info, 'readings-error-lower');
  await kitchenField.fill('51,5');
  await expect(kitchenBox.getByRole('alert')).toHaveCount(0);
  await expect(kitchenBox).toContainText('Расход: 1,500 м³');

  // 3. Переход через ноль: 99 998,5 → 3 при пяти цифрах до запятой.
  const hotBox = meterRegion(page, 'ГВС, санузел');
  await hotBox.getByLabel('Новое значение, м³').fill('3');
  await expect(hotBox.getByRole('alert')).toHaveText('Меньше прошлого: 99998,500');
  await hotBox.getByRole('checkbox', { name: 'Переход через ноль' }).check();
  await expect(hotBox.getByRole('alert')).toHaveCount(0);
  await expect(hotBox).toContainText('Расход: 4,500 м³');

  // 4. Две зоны: запятая и точка равны.
  const powerBox = meterRegion(page, 'Электроэнергия, коридор');
  await powerBox.getByLabel('День: новое значение, кВт·ч').fill('1010,5');
  await powerBox.getByLabel('Ночь: новое значение, кВт·ч').fill('505.5');
  await expect(powerBox).toContainText('Расход: День 10,5 кВт·ч · Ночь 5,5 кВт·ч');

  // 5. Фото к показанию и значение, которое на 40% выше обычного.
  await kitchenBox
    .locator('input[type="file"]')
    .setInputFiles({ name: 'meter.png', mimeType: 'image/png', buffer: makePng(64, 64) });
  await expect(kitchenBox.getByText('Фото 1')).toBeVisible();
  await meterRegion(page, 'ХВС, санузел').getByLabel('Новое значение, м³').fill('135');
  await expect(meterRegion(page, 'ХВС, санузел')).toContainText('Расход: 15,000 м³');

  // 6. Дата не позже прошлого показания — понятная ошибка, ничего не отправлено.
  await page.getByLabel('Дата показаний').fill(HISTORY[2]);
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Выберите дату позже' })).toBeVisible();
  await page.getByLabel('Дата показаний').fill(today());
  await checkApp(page, info, 'readings-filled');

  // 7. Одно «Сохранить всё» — четыре показания.
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(toast(page)).toContainText('Показания сохранены');
  await expect(page).toHaveURL(new RegExp(`/home/${property.id}/readings/transfer$`));
  const saved = page.getByRole('region', { name: 'Показания сохранены' });
  await expect(saved.getByRole('listitem')).toHaveCount(4);
  await expect(saved).toContainText('Проверьте, нет ли утечки или ошибки');
  await expect(saved.getByText('Проверьте, нет ли утечки или ошибки')).toHaveCount(1);
  await expect(saved).toContainText('Расход: 15,000 м³');
  for (const [meter, expected] of [
    [cold, '135.000'],
    [hot, '3.000'],
    [kitchen, '51.500'],
  ] as const) {
    const series = await boris.get(`meters/${meter.id}/readings`);
    const rows = series.body as { values: string[]; rollover: boolean; photoIds: string[] }[];
    expect(rows.at(-1)?.values).toEqual([expected]);
  }
  const hotRows = (await boris.get(`meters/${hot.id}/readings`)).body as { rollover: boolean }[];
  expect(hotRows.at(-1)?.rollover).toBe(true);
  const powerRows = (await boris.get(`meters/${power.id}/readings`)).body as { values: string[] }[];
  expect(powerRows.at(-1)?.values).toEqual(['1010.5', '505.5']);
  const kitchenRows = (await boris.get(`meters/${kitchen.id}/readings`)).body as {
    photoIds: string[];
  }[];
  expect(kitchenRows.at(-1)?.photoIds).toHaveLength(1);
  await checkApp(page, info, 'transfer-saved');

  // 8. Передача: значения по лицевому счёту, копирование, способ передачи, одна отметка.
  const account = page.getByRole('region', { name: 'Вода и свет' });
  await expect(account).toContainText('TEST-777');
  await account.getByRole('button', { name: 'Скопировать значение: ХВС, кухня' }).click();
  await expect(toast(page)).toContainText('Скопировано');
  expect(await readClipboard(page)).toBe('51,500');
  await account.getByRole('button', { name: 'Скопировать номер лицевого счёта' }).click();
  expect(await readClipboard(page)).toBe('TEST-777');
  await account.getByRole('button', { name: 'Скопировать всё' }).click();
  const all = (await readClipboard(page)).replaceAll('\r\n', '\n');
  expect(all.split('\n')[0]).toBe('Вода и свет, лицевой счёт TEST-777');
  expect(all).toContain('ХВС, санузел: 135,000');
  expect(all).toContain('ГВС, санузел: 3,000');
  expect(all).toContain('Электроэнергия, коридор (День): 1010,5');
  expect(all).toContain('Электроэнергия, коридор (Ночь): 505,5');
  expect(all).toContain('ХВС, кухня: 51,500');
  await expect(account.getByRole('link', { name: 'Открыть «Госуслуги Дом»' })).toHaveAttribute(
    'href',
    'https://dom.gosuslugi.ru/',
  );
  await checkApp(page, info, 'transfer-groups');
  await expect(page.getByRole('button', { name: /Отметить переданными/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Отметить переданными' }).click();
  await expect(toast(page)).toContainText('отмечены переданными');
  await expect(page.getByRole('region', { name: 'Передавать нечего' })).toBeVisible();
  for (const meter of [cold, hot, power, kitchen]) {
    const rows = (await boris.get(`meters/${meter.id}/readings`)).body as {
      transmissionStatus: string;
      transmissionMethod: string | null;
    }[];
    expect(rows.at(-1)).toMatchObject({
      transmissionStatus: 'transmitted',
      transmissionMethod: 'Госуслуги Дом',
    });
  }
  await checkApp(page, info, 'transfer-done');

  // 9. Переход к другому объекту.
  await page.getByRole('link', { name: 'Ввод' }).click();
  await page.getByRole('button', { name: 'Другой объект' }).click();
  const dialog = page.getByRole('dialog', { name: 'Другой объект' });
  await expect(dialog).toContainText('Сдаётся');
  await expect(dialog).not.toContainText('Квартира у парка');
  await checkApp(page, info, 'readings-switch');
  await dialog.getByRole('link', { name: /Дача у реки/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Дача у реки', exact: true }),
  ).toBeVisible();
  expect(dacha.id).not.toBe('');

  // 10. Ни значений, ни номеров, ни названий в хранилищах, кэше, адресе и консоли.
  const secrets = ['FICTION-12345', 'TEST-777', 'Квартира у парка', '1010,5'];
  await expectNothingStored(page, secrets);
  for (const secret of secrets) expect(consoleTexts.join('\n')).not.toContain(secret);
});

test('предупреждение 40%: «Исправить значение» убирает последнее показание и возвращает его в форму', async ({
  page,
  family,
}, info) => {
  const { boris, property, cold } = await seedFlat(family);
  await signInAs(page, family, 'adult');
  await openReadings(page, property.id, 'Квартира у парка');
  const box = meterRegion(page, 'ХВС, санузел');
  await box.getByLabel('Новое значение, м³').fill('135');
  await page.getByLabel('Дата показаний').fill(today());
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  const saved = page.getByRole('region', { name: 'Показания сохранены' });
  await expect(saved).toContainText('Проверьте, нет ли утечки или ошибки');
  await checkApp(page, info, 'transfer-warning');

  await saved.getByRole('button', { name: 'Исправить значение' }).click();
  await expect(page).toHaveURL(new RegExp(`/home/${property.id}/readings$`));
  await expect(toast(page)).toContainText('Показание убрано в корзину');
  await expect(box.getByLabel('Новое значение, м³')).toHaveValue('135,000');
  const rows = (await boris.get(`meters/${cold.id}/readings`)).body as { values: string[] }[];
  expect(rows.at(-1)?.values).toEqual(['120.000']);
  await box.getByLabel('Новое значение, м³').fill('128,5');
  await page.getByRole('button', { name: 'Сохранить всё' }).click();
  await expect(page.getByRole('region', { name: 'Показания сохранены' })).not.toContainText(
    'Проверьте, нет ли утечки или ошибки',
  );
});

test('замена счётчика с экрана «Показания»: старый уходит в архив, новый начинает с нового показания', async ({
  page,
  family,
}, info) => {
  test.setTimeout(120_000);
  const { boris, property, kitchen } = await seedFlat(family);
  await signInAs(page, family, 'adult');
  await openReadings(page, property.id, 'Квартира у парка');
  const box = meterRegion(page, 'ХВС, кухня');
  await box.getByLabel('Новое значение, м³').fill('2,5');
  await box.getByRole('button', { name: 'Замена счётчика' }).click();
  const dialog = page.getByRole('dialog', { name: 'Замена счётчика' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Показание, м³').last()).toHaveValue('2,5');
  await checkApp(page, info, 'replace-sheet');

  // Конечное показание старого не может быть меньше прошлого.
  await dialog.getByLabel('Показание, м³').first().fill('40');
  await dialog.getByRole('button', { name: 'Заменить счётчик' }).click();
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'Меньше прошлого: 50,000' }),
  ).toBeVisible();
  await dialog.getByLabel('Показание, м³').first().fill('57,25');
  await dialog.getByLabel('Заводской номер').fill('FICTION-55555');
  await dialog.getByLabel('Место установки').fill('Кухня, новый');
  await dialog.getByRole('button', { name: 'Заменить счётчик' }).click();
  await expect(toast(page)).toContainText('Счётчик заменён');
  await expect(dialog).toHaveCount(0);

  // Старый заменён и больше не в списке ввода; новый на месте со своим начальным показанием.
  await expect(page.getByRole('region', { name: 'ХВС, кухня' })).toHaveCount(1);
  const list = await boris.get(`objects/${property.id}/meters?status=all`);
  const rows = list.body as {
    id: string;
    data: { status: string; serialNumber: string };
    previousReading: { values: string[] } | null;
    previousMeterId: string | null;
  }[];
  expect(rows.find((row) => row.id === kitchen.id)?.data.status).toBe('replaced');
  const fresh = rows.find((row) => row.previousMeterId === kitchen.id);
  expect(fresh?.data).toMatchObject({ status: 'active', serialNumber: 'FICTION-55555' });
  expect(fresh?.previousReading?.values).toEqual(['2.500']);
  const old = (await boris.get(`meters/${kitchen.id}/readings`)).body as {
    values: string[];
    consumption: string[] | null;
  }[];
  expect(old.at(-1)).toMatchObject({ values: ['57.250'], consumption: ['7.250'] });
});

test('вкладка «Счётчики»: создание с начальным показанием, поверка, правка и свёрнутая группа', async ({
  page,
  family,
}, info) => {
  test.setTimeout(180_000);
  const boris = await apiAs(family, 'adult');
  const property = await seedProperty(boris, family, {
    title: 'Квартира у парка',
    audience: 'adults',
    typeData: { kind: 'apartment', status: 'living' },
  });
  await seedAccount(boris, property.id, {
    title: 'Вода и свет',
    data: { services: ['water_sewerage'], number: 'TEST-777' },
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${property.id}/meters`);
  await expect(page.getByRole('region', { name: 'Счётчиков пока нет' })).toBeVisible();
  await checkApp(page, info, 'meters-empty');

  await page.getByRole('button', { name: 'Добавить счётчик' }).click();
  const form = page.locator('form.meter-form');
  await form.getByLabel('Ресурс').selectOption({ label: 'Горячая вода (ГВС)' });
  await form.getByLabel('Место установки').fill('Санузел');
  await form.getByLabel('Заводской номер').fill('FICTION-12345');
  await form.getByLabel('Лицевой счёт').selectOption({ index: 1 });
  await form.getByLabel('Дата последней поверки').fill('2022-10-08');
  // Интервал ГВС по приложению А — 4 года; дату следующей поверки можно поправить.
  await expect(form.getByLabel('Дата следующей поверки')).toHaveValue('2026-10-08');
  await expect(form).toContainText('Вычислено: 8 окт. 2026');
  await form.getByLabel('Дата следующей поверки').fill('2026-12-15');
  await form.getByLabel('Дата показания').fill('2026-09-20');
  await form.getByLabel('Показание, м³').fill('12,5');
  await checkApp(page, info, 'meter-form');
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(toast(page)).toContainText('Счётчик сохранён');

  const list = page.getByRole('list', { name: 'Счётчики' });
  const card = list.getByRole('listitem').first();
  await expect(card.getByRole('heading', { level: 3 })).toHaveText('ГВС, Санузел');
  await expect(card).toContainText('12,500 м³');
  await expect(card).toContainText('15 дек. 2026');
  await expect(card).toContainText('Вода и свет, TEST-777');
  await card.getByRole('button', { name: 'Скопировать заводской номер' }).click();
  expect(await readClipboard(page)).toBe('FICTION-12345');
  await checkApp(page, info, 'meters-list');

  // Правка: после первого показания ресурс, зоны и разрядность не меняются.
  await card.getByRole('button', { name: 'Править' }).click();
  const edit = page.locator('form.meter-form');
  await expect(edit.getByLabel('Ресурс')).toBeDisabled();
  await expect(edit.getByLabel('Тарифность')).toBeDisabled();
  await edit.getByLabel('Модель').fill('Вымышленная модель');
  await edit.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(card).toContainText('Вымышленная модель');
  // Поправленная вручную дата поверки сохранилась.
  await expect(card).toContainText('15 дек. 2026');

  // Замена с карточки: старый уходит в свёрнутую группу.
  await card.getByRole('button', { name: 'Заменить счётчик' }).click();
  const dialog = page.getByRole('dialog', { name: 'Замена счётчика' });
  await dialog.getByLabel('Показание, м³').first().fill('13');
  await dialog.getByLabel('Показание, м³').last().fill('0,1');
  await dialog.getByRole('button', { name: 'Заменить счётчик' }).click();
  await expect(toast(page)).toContainText('Счётчик заменён');
  const archive = page.locator('details.meter-archive');
  await expect(archive.locator('summary')).toHaveText('Заменённые и снятые (1)');
  await expect(archive).not.toHaveAttribute('open', '');
  await archive.locator('summary').click();
  await expect(archive).toContainText('Заменён');
  await checkApp(page, info, 'meters-archive');

  // Лента: показания объекта (OBJ-3) — счётчик, значения и расход.
  await page
    .getByRole('navigation', { name: 'Разделы объекта' })
    .getByRole('link', { name: 'Лента' })
    .click();
  const timeline = page.getByRole('list', { name: 'Лента объекта' });
  await expect(timeline.getByText('Показание: ГВС, Санузел').first()).toBeVisible();
  await expect(timeline).toContainText('Расход: 0,500 м³');
  await expect(timeline).toContainText('начальное показание');
  await checkApp(page, info, 'timeline-readings');
});

test('ребёнок не видит счётчики, показания и события показаний объекта «Взрослые»; в общем — только читает', async ({
  page,
  family,
}, info) => {
  const { boris, property } = await seedFlat(family);
  const shared = await seedProperty(boris, family, {
    title: 'Дача для всех',
    audience: 'household',
    typeData: { kind: 'dacha_land', status: 'living' },
  });
  const common = await seedMeter(boris, shared.id, {
    title: 'Электроэнергия, веранда',
    data: { resource: 'electricity', installationPlace: 'Веранда' },
    initial: { occurredOn: '2026-09-20', values: ['10.000'] },
  });
  const vera = await apiAs(family, 'child');
  expect((await vera.get(`objects/${property.id}/meters`)).status).toBe(404);
  expect((await vera.get(`objects/${property.id}/timeline`)).status).toBe(404);
  expect((await vera.get(`objects/${property.id}/transmission`)).status).toBe(404);
  expect((await vera.get(`meters/${common.id}`)).status).toBe(200);
  expect(
    (await vera.post(`meters/${common.id}/readings`, { occurredOn: today(), values: ['11.000'] }))
      .status,
  ).toBe(403);

  await signInAs(page, family, 'child');
  await page.goto(`#/home/${property.id}/meters`);
  await expect(page.getByRole('alert').filter({ hasText: 'Объекта больше нет' })).toBeVisible();
  await expect(page.getByText('ХВС, санузел')).toHaveCount(0);
  await page.goto(`#/home/${property.id}/readings`);
  await expect(page.getByRole('alert').filter({ hasText: 'Объекта больше нет' })).toBeVisible();
  await expect(page.getByText('FICTION-12345')).toHaveCount(0);
  await checkApp(page, info, 'readings-child-hidden');

  await page.goto('#/more');
  await page.getByRole('link', { name: /^Показания/ }).click();
  const options = page.getByRole('list', { name: 'Недвижимость' });
  await expect(options).toContainText('Дача для всех');
  await expect(options).not.toContainText('Квартира у парка');

  await page.goto(`#/home/${shared.id}/meters`);
  const card = page.getByRole('list', { name: 'Счётчики' }).getByRole('listitem').first();
  await expect(card).toContainText('Электроэнергия, веранда');
  await expect(card.getByRole('button', { name: 'Править' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить счётчик' })).toHaveCount(0);
  await checkApp(page, info, 'meters-child-readonly');
  await page.goto(`#/home/${shared.id}/readings`);
  await expect(page.getByText('Вводить показания могут только взрослые')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить всё' })).toHaveCount(0);
  await expect(page.getByLabel('Новое значение, кВт·ч')).toHaveCount(0);
  await checkApp(page, info, 'readings-child-readonly');
});
