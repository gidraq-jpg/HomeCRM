import type { Browser, Page, TestInfo } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import { expect, signInAs } from './support.ts';

/** Вызовы API от имени вымышленного участника: так заметки заводятся быстро, без экрана. */
export interface Api {
  get(path: string): Promise<{ status: number; body: unknown }>;
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  patch(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  /** Загрузка файла (multipart), как её делает приложение. */
  upload(path: string, file: UploadPayload): Promise<{ status: number; body: unknown }>;
  /** Ответ без разбора тела: для файлов и проверок кода ответа. */
  raw(path: string): Promise<Response>;
}

export interface UploadPayload {
  name: string;
  type: string;
  data: Buffer;
}

/** Взрослый и ребёнок входят по паролю; администратору нужен второй фактор, он ходит через экран. */
export async function apiAs(family: Family, role: 'adult' | 'child'): Promise<Api> {
  return apiAsUser(family, role, family.person(role).password);
}

/** То же по имени и паролю: так входит участник, которого тест добавил сам (второй ребёнок). */
export async function apiAsUser(family: Family, username: string, password: string): Promise<Api> {
  const { origin } = family;
  const signed = await fetch(`${origin}/api/auth/sign-in/username`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (signed.status !== 200) throw new Error('Test sign-in failed');
  const cookie = signed.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${origin}/api/${path}`, {
      method,
      headers: {
        origin,
        cookie,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as unknown };
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    async upload(path, file) {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
      const response = await fetch(`${origin}/api/${path}`, {
        method: 'POST',
        headers: { origin, cookie },
        body: form,
      });
      return {
        status: response.status,
        body: (await response.json().catch(() => null)) as unknown,
      };
    },
    raw: (path) => fetch(`${origin}/api/${path}`, { headers: { origin, cookie } }),
  };
}

export interface CreatedNote {
  id: string;
  title: string;
  updatedAt: string;
}

/** Заводит заметку через API. `audience` задаёт общее место в доме; без него заметка личная. */
export async function seedNote(
  api: Api,
  family: Family,
  note: {
    title: string;
    body?: string;
    pinned?: boolean;
    checklist?: { title: string; done?: boolean }[];
    audience?: 'household' | 'adults';
  },
): Promise<CreatedNote> {
  const { audience, ...fields } = note;
  const created = await api.post('notes', {
    ...fields,
    ...(audience ? { placement: { spaceId: family.houseId, audience } } : {}),
  });
  if (created.status !== 201) throw new Error(`Test note was not created: ${created.status}`);
  return created.body as CreatedNote;
}

/** Другой участник в отдельном окне браузера: у него свои cookie и свой вход. */
export async function openAs(
  browser: Browser,
  family: Family,
  info: TestInfo,
  role: 'admin' | 'adult' | 'child',
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
  await signInAs(page, family, role);
  return { page, close: () => context.close() };
}

/** Список заметок на экране «Заметки»: ссылки по названию. */
export const noteLinks = (page: Page) =>
  page.getByRole('main').getByRole('link', { name: /Кто видит:/ });

export async function openNotes(page: Page) {
  // Сначала в другой раздел: тот же адрес не пересоздаёт экран, а нужны свежие данные сервера.
  await page.goto('#/more');
  await page.goto('#/more/notes');
  await expect(page.getByRole('heading', { level: 1, name: 'Заметки', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем заметки…')).toHaveCount(0);
}

/** Ничего из `secrets` не лежит ни в хранилищах браузера, ни в кэше, ни в адресе и названии вкладки. */
export async function expectNothingStored(page: Page, secrets: readonly string[]) {
  const dump = await page.evaluate(async () => {
    const parts: string[] = [location.href, document.title];
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i) ?? '';
        parts.push(key, storage.getItem(key) ?? '');
      }
    }
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) parts.push(request.url);
    }
    const databases = (await indexedDB.databases?.()) ?? [];
    for (const database of databases) parts.push(database.name ?? '');
    return parts.join('\n');
  });
  for (const secret of secrets)
    expect(dump, `«${secret}» в хранилищах браузера`).not.toContain(secret);
  // В кэше сервис-воркера только файлы сборки, никакого /api.
  expect(dump).not.toContain('/api/');
}

export interface CreatedObject {
  id: string;
  title: string;
  updatedAt: string;
  fields: { id: string; name: string; value: string }[];
}

/** Заводит объект через API. `audience` задаёт общее место в доме; без него объект личный. */
export async function seedObject(
  api: Api,
  family: Family,
  object: {
    title: string;
    objectType?: 'property' | 'car' | 'appliance' | 'other';
    fields?: { name: string; value: string }[];
    audience?: 'household' | 'adults';
  },
): Promise<CreatedObject> {
  const { audience, ...rest } = object;
  const created = await api.post('objects', {
    ...rest,
    ...(audience ? { placement: { spaceId: family.houseId, audience } } : {}),
  });
  if (created.status !== 201) throw new Error(`Test object was not created: ${created.status}`);
  return created.body as CreatedObject;
}

/** Список объектов на экране «Дом»: ссылки по названию. */
export const objectLinks = (page: Page) =>
  page.getByRole('main').getByRole('link', { name: /Кто видит:/ });

export async function openHome(page: Page) {
  // Сначала в другой раздел: тот же адрес не пересоздаёт экран, а нужны свежие данные сервера.
  await page.goto('#/more');
  await page.goto('#/home');
  await expect(page.getByRole('heading', { level: 1, name: 'Дом', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем объекты…')).toHaveCount(0);
}
