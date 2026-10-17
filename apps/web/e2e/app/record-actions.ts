import type { Page } from '@playwright/test';
import { expect } from './support.ts';

/** D16a: прежнее действие доступно через лист «Ещё». Ошибки доступа и формы не обходятся. */
export async function openRecordActions(page: Page) {
  if (await page.getByRole('dialog').count()) return;
  if (
    /^#\/(today\/tasks|more\/notes|people\/contacts|more\/organizations|documents)\/[a-f0-9-]+$/.test(
      new URL(page.url()).hash,
    )
  ) {
    await expect(
      page
        .getByRole('button', { name: 'Ещё: действия с записью' })
        .or(page.getByText(/больше нет|стал[аи]? вам недоступ/))
        .first(),
    ).toBeVisible();
  }
  const trigger = page.getByRole('button', { name: 'Ещё: действия с записью', exact: true });
  if ((await trigger.isVisible()) && !(await page.getByRole('dialog').count()))
    await trigger.click();
}
export async function closeRecordActions(page: Page) {
  if (!(await page.locator('.ui6-record-page').count())) return;
  const more = page.getByRole('dialog', { name: 'Ещё', exact: true });
  if (await more.isVisible()) {
    await more.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await expect(more).toHaveCount(0);
  }
}
