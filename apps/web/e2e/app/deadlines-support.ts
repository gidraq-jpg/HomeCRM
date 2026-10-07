import { createWorkerDatabase } from '@homecrm/db';
import type { Locator, Page } from '@playwright/test';
import {
  initializeHouseTimeZones,
  refreshDeadlines,
} from '../../../server/src/deadlines/engine.ts';
import type { Family } from '../auth/support/family.ts';
import type { Api } from './notes-support.ts';
import { expect } from './support.ts';

// Сроки и радар (R0.8b): вымышленные записи заводятся через API, срок — тоже, а пересчёт наступлений
// делает обработчик сроков. В сквозном тесте его нет, поэтому пересчёт вызывается здесь вручную.

export const HOME_ZONE = 'Europe/Moscow';

/** Дата в часовом поясе дома через `days` дней от сегодняшней: `2026-10-12`. */
export function homeDate(days: number, zone: string = HOME_ZONE): string {
  const moment = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(moment);
}

/** Пояс дома задаётся до входа: так тест не зависит от пояса сервера по умолчанию. */
export async function setHomeZone(family: Family, zone: string = HOME_ZONE) {
  await family.database.admin.query("UPDATE spaces SET time_zone = $1 WHERE kind = 'household'", [
    zone,
  ]);
}

/** Пересчёт наступлений, как его делает обработчик сроков; радар до него пуст. */
export async function recalc(family: Family) {
  const worker = createWorkerDatabase(family.database.worker);
  await initializeHouseTimeZones(worker, HOME_ZONE);
  await refreshDeadlines(worker, new Date(), true);
}

export async function seedDeadline(
  api: Api,
  source: 'notes' | 'objects',
  sourceId: string,
  rule: Record<string, unknown>,
): Promise<string> {
  const created = await api.post(`${source}/${sourceId}/deadlines`, { rule });
  if (created.status !== 201) throw new Error(`Test deadline was not created: ${created.status}`);
  return (created.body as { id: string }).id;
}

/** Блок «Сроки» в карточке записи. */
export const deadlinesSection = (page: Page): Locator =>
  page
    .locator('section.section')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Сроки', exact: true }) });

export const deadlineForm = (page: Page): Locator => page.locator('form.deadline-form');

export async function openObjectCard(page: Page, id: string, title: string) {
  await page.goto(`#/home/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем сроки…')).toHaveCount(0);
}

export async function openNoteCard(page: Page, id: string, title: string) {
  await page.goto(`#/more/notes/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем сроки…')).toHaveCount(0);
}

export async function openRadar(page: Page) {
  // Сначала в другой раздел: тот же адрес не пересоздаёт экран, а нужны свежие данные сервера.
  await page.goto('#/more');
  await page.goto('#/more/radar');
  // Данные, заведённые тестом через API, обходят клиентскую инвалидацию.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Радар', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем радар…')).toHaveCount(0);
}

/** Пункты радара одной группы: ссылки по названию записи. */
export const groupItems = (page: Page, group: string): Locator =>
  page.getByRole('list', { name: group, exact: true }).getByRole('listitem');

/** Подписи всех пунктов радара, по группам; пустые группы не показываются. */
export async function radarSummary(page: Page): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const group of ['Просрочено', 'Сейчас', '7 дней', '30 дней', '90 дней']) {
    const count = await page
      .getByRole('list', { name: group, exact: true })
      .getByRole('listitem')
      .count();
    if (count > 0) result[group] = count;
  }
  return result;
}
