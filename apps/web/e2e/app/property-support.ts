import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import type { Api } from './notes-support.ts';
import { expect } from './support.ts';

// Недвижимость, организации и лицевые счета (R1a.1b). Семья вымышленная; всё заводится через API,
// а проверяется на экране. Названия и номера — выдуманные, в журнал и хранилища они попасть не должны.

export interface Seeded {
  id: string;
  title: string;
  updatedAt: string;
}

async function created(response: { status: number; body: unknown }, what: string): Promise<Seeded> {
  if (response.status !== 201) throw new Error(`Test ${what} was not created: ${response.status}`);
  return response.body as Seeded;
}

export async function seedProperty(
  api: Api,
  family: Family,
  property: {
    title: string;
    audience?: 'adults' | 'household';
    typeData?: Record<string, unknown>;
  },
): Promise<Seeded> {
  const { audience, ...rest } = property;
  return created(
    await api.post('objects', {
      ...rest,
      objectType: 'property',
      placement: { spaceId: family.houseId, ...(audience ? { audience } : {}) },
    }),
    'property',
  );
}

export async function seedOrganization(
  api: Api,
  organization: {
    title: string;
    data?: Record<string, unknown>;
    /** Без места — общая «Вся семья»; `personalSpaceId` — личная организация участника. */
    placement?: { spaceId: string; audience?: 'adults' | 'household' };
  },
): Promise<Seeded> {
  return created(await api.post('contacts', organization), 'organization');
}

export async function seedAccount(
  api: Api,
  objectId: string,
  account: { title?: string; supplierId?: string; data?: Record<string, unknown> },
): Promise<Seeded> {
  return created(await api.post(`objects/${objectId}/accounts`, account), 'account');
}

export async function seedLink(
  api: Api,
  objectId: string,
  contactId: string,
  role: string,
): Promise<void> {
  const linked = await api.post('links', {
    left: { type: 'object', id: objectId },
    right: { type: 'contact', id: contactId },
    role,
  });
  if (linked.status !== 201) throw new Error(`Test link was not created: ${linked.status}`);
}

/** Открыть вкладку карточки объекта по адресу и дождаться заголовка. */
export async function openObjectTab(page: Page, objectId: string, tab: string, title: string) {
  await page.goto('#/more');
  await page.goto(`#/home/${objectId}${tab}`);
  await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible();
}
