import { randomBytes } from 'node:crypto';
import { createAuthDatabase } from '@homecrm/db';
import type { Browser, Page, TestInfo } from '@playwright/test';
import { provisionAccount } from '../../../server/src/auth/provision.ts';
import type { Family } from '../auth/support/family.ts';
import { type Api, apiAsUser } from './notes-support.ts';
import { expect } from './support.ts';

// Документы (R1a.9b, DOC-1…7). Семья вымышленная: Анна — администратор, Борис — взрослый, Вера —
// ребёнок. Серии и номера выдуманные: в журнал консоли, адреса и хранилища они попадать не должны.

export interface SeededDocument {
  id: string;
  title: string;
  updatedAt: string;
  status: 'valid' | 'invalid';
}

export interface DocumentSeed {
  title: string;
  type?: string;
  series?: string;
  number?: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  indefinite?: boolean;
  tags?: string[];
  owner?: { kind: 'member' | 'object' | 'contact'; id: string } | null;
  /** Без места документ личный; `family.houseId` с аудиторией — общий. */
  placement?: { spaceId: string; audience?: 'adults' | 'household' };
}

export async function seedDocument(api: Api, seed: DocumentSeed): Promise<SeededDocument> {
  const { title, owner, placement, ...data } = seed;
  const created = await api.post('documents', {
    title,
    data,
    ...(owner === undefined ? {} : { owner }),
    ...(placement ? { placement } : {}),
  });
  if (created.status !== 201) throw new Error(`Test document was not created: ${created.status}`);
  return created.body as SeededDocument;
}

/** Второй ребёнок дома: Вера уже есть, а правило «чужое удостоверение ребёнка» проверяется на двоих. */
export async function addChild(family: Family) {
  const password = randomBytes(18).toString('base64url');
  const person = await provisionAccount(createAuthDatabase(family.database.admin), {
    username: 'child2',
    displayName: 'Петя',
    password,
    householdId: family.houseId,
    role: 'child',
  });
  return { id: person.id, username: 'child2', password };
}

export async function apiAsChild2(family: Family, child: { username: string; password: string }) {
  return apiAsUser(family, child.username, child.password);
}

/** Окно участника, которого нет среди ролей по умолчанию. */
export async function openAsUser(
  browser: Browser,
  family: Family,
  info: TestInfo,
  user: { username: string; password: string },
): Promise<{ page: Page; close: () => Promise<void> }> {
  const use = info.project.use;
  const context = await browser.newContext({
    baseURL: family.baseURL,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    colorScheme: 'light',
    ...(use.viewport ? { viewport: use.viewport } : {}),
    ...(use.isMobile === undefined ? {} : { isMobile: use.isMobile }),
    ...(use.hasTouch === undefined ? {} : { hasTouch: use.hasTouch }),
    ...(use.deviceScaleFactor === undefined ? {} : { deviceScaleFactor: use.deviceScaleFactor }),
  });
  const page = await context.newPage();
  await page.goto('#/sign-in');
  await page.getByLabel('Имя пользователя или почта').fill(user.username);
  await page.getByLabel('Пароль', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня', exact: true })).toBeVisible();
  return { page, close: () => context.close() };
}

/** Открыть раздел «Документы» с чистого листа и дождаться конца загрузки. */
export async function openDocuments(page: Page) {
  // Сначала в другой раздел: тот же адрес не пересоздаёт экран, а нужны свежие данные сервера.
  await page.goto('#/more');
  await page.goto('#/documents');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Документы', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Загружаем документы…')).toHaveCount(0);
}

/** Ссылки списка документов по названию. */
export const documentLinks = (page: Page) =>
  page.getByRole('list', { name: 'Документы', exact: true }).getByRole('link');

/** Все сообщения консоли страницы: в них не должно быть ни серий, ни номеров. */
export function collectConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => messages.push(error.message));
  return messages;
}
