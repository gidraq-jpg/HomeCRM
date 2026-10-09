import type { Page } from '@playwright/test';
import type { Api } from './notes-support.ts';
import { expect } from './support.ts';

// Люди, взаимодействия и сроки паспорта (R1b.2b): CONT-1…5, DOC-3, DOC-4. Семья вымышленная, телефоны
// и адреса выдуманные: ни в консоли, ни в адресе, ни в хранилищах браузера их быть не должно.

export interface SeededContact {
  id: string;
  title: string;
  updatedAt: string;
}

export interface PersonSeed {
  title: string;
  data?: Record<string, unknown>;
  organizationId?: string;
  /** Без места человек личный; `spaceId` с аудиторией — общий. */
  placement?: { spaceId: string; audience?: 'adults' | 'household' };
}

export async function seedPerson(api: Api, seed: PersonSeed): Promise<SeededContact> {
  const created = await api.post('contacts', { kind: 'person', ...seed });
  if (created.status !== 201) throw new Error(`Test person was not created: ${created.status}`);
  return created.body as SeededContact;
}

export async function seedOrganization(
  api: Api,
  seed: { title: string; data?: Record<string, unknown> },
): Promise<SeededContact> {
  const created = await api.post('contacts', { kind: 'organization', ...seed });
  if (created.status !== 201)
    throw new Error(`Test organization was not created: ${created.status}`);
  return created.body as SeededContact;
}

export async function seedInteraction(
  api: Api,
  contactId: string,
  data: {
    text: string;
    kind?: 'call' | 'visit' | 'message' | 'work';
    occurredOn: string;
    amountCents?: number | null;
    callAgain?: boolean | null;
    objectId?: string | null;
  },
) {
  const created = await api.post(`contacts/${contactId}/interactions`, {
    kind: 'call',
    amountCents: null,
    callAgain: null,
    objectId: null,
    ...data,
  });
  if (created.status !== 201)
    throw new Error(`Test interaction was not created: ${created.status}`);
  return created.body as { id: string };
}

/** Раздел «Люди» с чистого листа: после загрузки списка контактов. */
export async function openPeople(page: Page) {
  // Сначала в другой раздел: тот же адрес не пересоздаёт экран, а нужны свежие данные сервера.
  await page.goto('#/more');
  await page.goto('#/people');
  await expect(page.getByRole('heading', { level: 1, name: 'Люди', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем контакты…')).toHaveCount(0);
}

export async function openContact(page: Page, id: string, title: string) {
  await page.goto(`#/people/contacts/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем взаимодействия…')).toHaveCount(0);
}

/** Ссылки списка «Контакты» раздела «Люди». */
export const contactLinks = (page: Page) =>
  page.getByRole('list', { name: 'Контакты', exact: true }).getByRole('link');
