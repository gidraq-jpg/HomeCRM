import { readFile } from 'node:fs/promises';
import { test } from '../auth/support/fixtures.ts';
import { seedMeter } from './meters-support.ts';
import { apiAs } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

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
