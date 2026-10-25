import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs } from './notes-support.ts';
import { seedAccount, seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

async function newReceiptForm(page: Page, family: Family, objectId: string, accountId: string) {
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${objectId}/accounts/${accountId}/charges`);
  await page.getByRole('button', { name: 'Добавить начисление', exact: true }).click();
  return page.locator('form.charge-form');
}
async function receiptImage(index = 1) {
  return {
    name: 'fiction-receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: await readFile(
      new URL(`../../../server/src/ai/eval/samples/receipts/${index}.jpg`, import.meta.url),
    ),
  };
}

for (const otherObject of [false, true])
  test(`UTIL-9: QR без ИИ → верный счёт, другой объект ${otherObject}`, async ({
    page,
    family,
  }, info) => {
    const api = await apiAs(family, 'adult');
    const source = await seedProperty(api, family, { title: 'Учебная квартира' });
    const account = await seedAccount(api, source.id, {
      title: 'Исходный счёт',
      data: { number: otherObject ? '9900000099' : '9900000010' },
    });
    const target = otherObject
      ? await seedProperty(api, family, { title: 'Учебная дача' })
      : source;
    const targetAccount = otherObject
      ? await seedAccount(api, target.id, { title: 'Счёт из QR', data: { number: '9900000010' } })
      : account;
    let calls = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/ai/receipt-photo')) calls++;
    });
    const form = await newReceiptForm(page, family, source.id, account.id);
    // Явно проверяется резервный декодер, даже если системный API доступен в Chromium.
    await page.evaluate(() => {
      Object.defineProperty(globalThis, 'BarcodeDetector', {
        value: undefined,
        configurable: true,
      });
    });
    await form.getByLabel('Квитанция для заполнения').setInputFiles(await receiptImage());
    await expect(
      form.getByText('QR прочитан на телефоне без ИИ. Проверьте счёт, сумму и период.'),
    ).toBeVisible();
    await expect(form.getByLabel(/Счёт из квитанции/)).toHaveValue(targetAccount.id);
    await expect(form.getByLabel('Итог, ₽', { exact: true })).toHaveValue('1234,56');
    await expect(form.getByLabel('Расчётный месяц', { exact: true })).toHaveValue('2026-09');
    await form.getByLabel(/Срок оплаты/).fill('2026-10-25');
    if (otherObject) await form.getByRole('checkbox', { name: 'Приложить фото квитанции' }).check();
    expect(calls).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toHaveCount(0);
    expect(
      (await family.database.admin.query('SELECT count(*)::int AS n FROM utility_charges')).rows[0]
        .n,
    ).toBe(0);
    expect(
      (await family.database.admin.query('SELECT count(*)::int AS n FROM object_files')).rows[0].n,
    ).toBe(0);
    await checkApp(page, info, otherObject ? 'receipt-qr-other-object' : 'receipt-qr');
    await form.getByRole('button', { name: 'Сохранить начисление', exact: true }).click();
    await expect(page.locator('.toast-region')).toContainText('Начисление сохранено');
    const charges = await api.get(`accounts/${targetAccount.id}/charges`);
    const rows = charges.body as { totalCents: number; receiptIds: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalCents).toBe(123456);
    expect(rows[0]?.receiptIds).toHaveLength(otherObject ? 1 : 0);
    if (otherObject) {
      expect((await api.get(`accounts/${account.id}/charges`)).body).toEqual([]);
      expect(
        (
          await family.database.admin.query(
            'SELECT count(*)::int AS n FROM object_files WHERE parent_id=$1',
            [target.id],
          )
        ).rows[0].n,
      ).toBe(1);
    }
    expect(
      (await family.database.admin.query('SELECT count(*)::int AS n FROM ai_daily_usage')).rows[0]
        .n,
    ).toBe(0);
  });

test('UTIL-9: без QR → согласие → черновик ИИ; повтор без нового согласия и сбой сохраняют поля', async ({
  page,
  family,
}, info) => {
  await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    family.houseId,
  ]);
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, { title: 'Учебная квартира' });
  const account = await seedAccount(api, property.id, {
    title: 'Учебная вода',
    data: { number: '9900000014' },
  });
  const form = await newReceiptForm(page, family, property.id, account.id);
  await form.getByLabel('Квитанция для заполнения').setInputFiles(await receiptImage(5));
  await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toBeVisible();
  await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
  await expect(form.getByText('Черновик ИИ — проверьте поля.')).toBeVisible();
  await expect(form.getByLabel('Итог, ₽', { exact: true })).toHaveValue('1234,56');
  // Повторное фото с сохранённым согласием должно действительно запускать разбор.
  await form.getByLabel('Квитанция для заполнения').setInputFiles(await receiptImage(6));
  await expect(form.getByText('Черновик ИИ — проверьте поля.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toHaveCount(0);
  await page.route('**/api/ai/receipt-photo?**', (route) =>
    route.fulfill({ status: 429, json: { code: 'AI_DAILY_LIMIT' } }),
  );
  await form.getByLabel('Квитанция для заполнения').setInputFiles(await receiptImage(7));
  await expect(form.getByRole('alert')).toContainText('Дневной предел');
  await expect(form.getByLabel('Итог, ₽', { exact: true })).toHaveValue('1234,56');
  await checkApp(page, info, 'receipt-ai-error');
  await form.getByRole('button', { name: 'Сохранить начисление', exact: true }).click();
  await expect(page.locator('.toast-region')).toContainText('Начисление сохранено');
  expect(
    (await family.database.admin.query('SELECT count(*)::int AS n FROM object_files')).rows[0].n,
  ).toBe(0);
});

for (const keep of [false, true])
  test(`UTIL-4: фото → черновик → показание; приложение фото ${keep}`, async ({
    page,
    family,
  }, info) => {
    await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
      family.houseId,
    ]);
    const api = await apiAs(family, 'adult');
    const property = await seedProperty(api, family, { title: 'Учебная квартира' });
    const meter = await seedMeter(api, property.id, {
      title: 'Учебная вода',
      data: { resource: 'cold_water' },
    });
    await signInAs(page, family, 'adult');
    if (!keep)
      await page.route('**/api/ai/meter-photo?**', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.values[0].confident = false;
        await route.fulfill({ response, json });
      });
    await page.goto(`#/home/${property.id}/readings`);
    const section = page.getByRole('region', { name: 'Учебная вода' });
    if (keep) await section.getByRole('checkbox', { name: 'Приложить фото к показанию' }).check();
    await section.locator('input[type=file][aria-label="С фото"]').setInputFiles({
      name: 'fiction.jpg',
      mimeType: 'image/jpeg',
      buffer: await readFile(
        new URL('../../../server/src/ai/eval/samples/meters/1.jpg', import.meta.url),
      ),
    });
    await expect(page.getByRole('dialog', { name: 'Разбор с помощью ИИ' })).toBeVisible();
    await page.getByRole('button', { name: 'Согласен, разобрать' }).click();
    const value = section.getByLabel('Новое значение, м³', { exact: true });
    await expect(value).toHaveValue('1.222');
    if (!keep) await expect(section.getByRole('status')).toContainText('проверьте значения');
    expect(
      (
        await family.database.admin.query(
          'SELECT count(*)::int AS n FROM meter_readings WHERE parent_id=$1',
          [meter.id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await family.database.admin.query(
          'SELECT count(*)::int AS n FROM object_files WHERE parent_id=$1',
          [property.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await checkApp(page, info, `meter-photo-${keep ? 'attached' : 'temporary'}`);
    await page.getByRole('button', { name: 'Сохранить всё', exact: true }).click();
    await expect(page.locator('.toast-region')).toContainText('Показания сохранены');
    const saved = await api.get(`meters/${meter.id}/readings`);
    const rows = saved.body as { values: string[]; photoIds: string[] }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values).toEqual(['1.222']);
    expect(rows[0]?.photoIds).toHaveLength(keep ? 1 : 0);
  });
