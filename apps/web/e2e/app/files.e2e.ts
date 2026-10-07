import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test } from '../auth/support/fixtures.ts';
import {
  expectImageLoaded,
  filePicker,
  fileRows,
  makePng,
  PDF,
  PDF_MIME,
  PNG_MIME,
  pdfOfSize,
  servedImageSize,
} from './files-support.ts';
import {
  type Api,
  apiAs,
  expectNothingStored,
  openAs,
  seedNote,
  seedObject,
} from './notes-support.ts';
import { checkApp, expect, signInAs } from './support.ts';

// Файлы на экранах (R0.5e): OBJ-4, OBJ-1, SPACE-10. Семья вымышленная: Анна — администратор,
// Борис — взрослый, Вера — ребёнок. Файлы создаются в самих тестах.

const toast = (page: Page) => page.locator('.toast-region');
const MAX = 25 * 1024 * 1024;
const PHOTO = 'Фото счётчика.png';
const RECEIPT = 'Квитанция за воду.pdf';

async function sharedObject(api: Api, family: Parameters<typeof seedObject>[1]) {
  return seedObject(api, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'household',
  });
}

async function attach(
  api: Api,
  kind: 'objects' | 'notes',
  id: string,
  name: string,
  bytes: Buffer,
  type: string,
) {
  const answer = await api.upload(`${kind}/${id}/files`, { name, type, data: bytes });
  if (answer.status !== 201) throw new Error(`Test file was not attached: ${answer.status}`);
  return (answer.body as { id: string }).id;
}

test('вкладка «Файлы»: пустое состояние, загрузка фото и PDF по очереди, превью, просмотр, скачивание', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);

  const empty = page.getByRole('region', { name: 'Файлов пока нет' });
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('Файлы видят только те люди, которые видят саму запись.');
  await expect(page.getByRole('button', { name: 'Добавить файл' })).toBeVisible();
  await checkApp(page, info, 'files-empty');

  // Большое фото уменьшается до 2560 px по длинной стороне ещё на телефоне, PDF уходит как есть.
  await filePicker(page).setInputFiles([
    { name: PHOTO, mimeType: PNG_MIME, buffer: makePng(3200, 1800) },
    { name: RECEIPT, mimeType: PDF_MIME, buffer: PDF },
  ]);
  await expect(fileRows(page)).toHaveCount(2);
  await expect(page.getByRole('list', { name: 'Загрузка файлов' })).toHaveCount(0);
  await expect(empty).toHaveCount(0);
  await expect(fileRows(page).first()).toContainText(PHOTO);
  await expect(fileRows(page).first()).toContainText('Вы');
  await expect(fileRows(page).nth(1)).toContainText(RECEIPT);
  await expect(page.getByText('2 файла', { exact: true })).toBeVisible();

  // Превью фото — на экране; у PDF вместо превью значок.
  await expectImageLoaded(page, '.file-row__image');
  await expect(page.locator('.file-row__image')).toHaveCount(1);
  const source = await page.locator('.file-row__image').first().getAttribute('src');
  const id = /\/api\/files\/([^/]+)\/preview/.exec(source ?? '')?.[1] ?? '';
  expect(id).not.toBe('');
  const size = await servedImageSize(page, `/api/files/${id}`);
  expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2560);
  expect(size.width).toBe(2560);
  await checkApp(page, info, 'files-list');

  // Просмотр фото на экране и скачивание через /api/files/:id с сессией.
  await fileRows(page).first().getByRole('button', { name: 'Открыть' }).click();
  const viewer = page.getByRole('dialog', { name: 'Просмотр файла' });
  await expect(viewer).toBeVisible();
  await expectImageLoaded(page, '.file-viewer__image');
  await checkApp(page, info, 'files-viewer');
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    fileRows(page)
      .nth(1)
      .getByRole('link', { name: /^Скачать/ })
      .click(),
  ]);
  expect(download.suggestedFilename()).toBe(RECEIPT);
  expect(await readFile(await download.path())).toEqual(PDF);

  // Публичных ссылок нет, имена файлов не попали в адрес, хранилища браузера и название вкладки.
  const href = await fileRows(page)
    .nth(1)
    .getByRole('link', { name: /^Скачать/ })
    .getAttribute('href');
  expect(href).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
  await expectNothingStored(page, ['Квитанция', 'Фото счётчика', 'blob:']);
});

test('отказы: 25 МБ + 1 байт и чужой формат — до отправки, 413 и 415 сервера — понятными словами, отмена', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(page.getByRole('button', { name: 'Добавить файл' })).toBeVisible();

  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/files'))
      uploads.push(request.url());
  });

  // Предел проверяется до отправки: запрос не уходит вовсе.
  await filePicker(page).setInputFiles({
    name: 'Договор.pdf',
    mimeType: PDF_MIME,
    buffer: pdfOfSize(MAX + 1),
  });
  const failed = page.getByRole('list', { name: 'Загрузка файлов' });
  await expect(failed).toContainText('Файл больше 25 МБ. Уменьшите его или выберите другой.');
  await expect(failed.getByRole('button', { name: /^Повторить/ })).toHaveCount(0);
  await checkApp(page, info, 'files-too-large');
  await failed.getByRole('button', { name: /^Убрать/ }).click();
  await expect(failed).toHaveCount(0);

  // Ровно 25 МБ проходят проверку клиента (сервер принимает их же).
  await filePicker(page).setInputFiles({
    name: 'Договор.pdf',
    mimeType: PDF_MIME,
    buffer: pdfOfSize(MAX),
  });
  await expect(fileRows(page)).toHaveCount(1, { timeout: 30_000 });
  expect(uploads).toHaveLength(1);

  // Чужой формат отклоняется на экране, подделка — сервером (415).
  await filePicker(page).setInputFiles({
    name: 'заметки.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('просто текст'),
  });
  await expect(failed).toContainText(
    'Этот формат не подходит. Добавьте фото (JPEG, PNG, WebP, HEIC) или PDF.',
  );
  await failed.getByRole('button', { name: /^Убрать/ }).click();
  expect(uploads).toHaveLength(1);

  await filePicker(page).setInputFiles({
    name: 'Подделка.pdf',
    mimeType: PDF_MIME,
    buffer: Buffer.from('это не PDF'),
  });
  await expect(failed).toContainText('формат не подходит или файл повреждён');
  await expect(failed).not.toContainText('UNSUPPORTED');
  await checkApp(page, info, 'files-unsupported');
  await failed.getByRole('button', { name: /^Убрать/ }).click();
  await expect(fileRows(page)).toHaveCount(1);

  // 413 от сервера (например, запас прокси меньше) говорит то же, что и проверка на экране.
  await page.route('**/api/objects/*/files', (route) =>
    route.fulfill({
      status: 413,
      contentType: 'application/json',
      body: '{"code":"FILE_TOO_LARGE"}',
    }),
  );
  await filePicker(page).setInputFiles({ name: 'Акт.pdf', mimeType: PDF_MIME, buffer: PDF });
  await expect(failed).toContainText('Файл больше 25 МБ');
  await failed.getByRole('button', { name: /^Убрать/ }).click();
  await page.unroute('**/api/objects/*/files');

  // Отмена прерывает отправку: файл не появляется, ошибки нет.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/objects/*/files', async (route) => {
    await held;
    await route.abort().catch(() => undefined);
  });
  await filePicker(page).setInputFiles([
    { name: 'Первый.pdf', mimeType: PDF_MIME, buffer: PDF },
    { name: 'Второй.pdf', mimeType: PDF_MIME, buffer: PDF },
  ]);
  await expect(failed).toContainText('Загружаем…');
  await expect(failed).toContainText('Ждёт очереди');
  await checkApp(page, info, 'files-uploading');
  await failed.getByRole('button', { name: /^Отменить: Первый/ }).click();
  await expect(failed).not.toContainText('Первый.pdf');
  await failed.getByRole('button', { name: /^Отменить: Второй/ }).click();
  await expect(failed).toHaveCount(0);
  release();
  await expect(page.getByText('Не удалось выполнить действие')).toHaveCount(0);
  await expect(fileRows(page)).toHaveCount(1);
});

test('корзина файла: отмена за 7 секунд, восстановление, ребёнок не добавляет и не удаляет', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  await attach(boris, 'objects', object.id, PHOTO, makePng(640, 480), PNG_MIME);
  await attach(boris, 'objects', object.id, RECEIPT, PDF, PDF_MIME);
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(fileRows(page)).toHaveCount(2);

  const receipt = () => fileRows(page).filter({ hasText: RECEIPT });
  await receipt()
    .getByRole('button', { name: /^В корзину/ })
    .click();
  await expect(toast(page)).toContainText('Файл в корзине');
  await expect(toast(page)).toContainText('Хранится 30 дней');
  await expect(fileRows(page)).toHaveCount(1);
  const trashed = await family.database.admin.query(
    'SELECT title, deleted_at IS NOT NULL AS deleted FROM object_files ORDER BY created_at',
  );
  expect(trashed.rows).toEqual([
    { title: PHOTO, deleted: false },
    { title: RECEIPT, deleted: true },
  ]);

  // «Отменить» в течение 7 секунд возвращает файл на место.
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Файл возвращён');
  await expect(fileRows(page)).toHaveCount(2);

  // Удалили и не отменили: файл остаётся в «Удалённых файлах» записи, его можно вернуть.
  await receipt()
    .getByRole('button', { name: /^В корзину/ })
    .click();
  const removed = page.getByRole('list', { name: 'Удалённые файлы' });
  await expect(removed).toContainText(RECEIPT);
  await expect(removed.getByRole('button', { name: /^Восстановить/ })).toBeVisible();
  await checkApp(page, info, 'files-trash');
  await removed.getByRole('button', { name: /^Восстановить/ }).click();
  await expect(toast(page)).toContainText('Файл возвращён');
  await expect(removed).toHaveCount(0);
  await expect(fileRows(page)).toHaveCount(2);

  // Вера видит файлы общего объекта и скачивает их, но не добавляет и не удаляет.
  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto(`#/home/${object.id}/files`);
    await expect(fileRows(vera.page)).toHaveCount(2);
    await expect(vera.page.getByRole('button', { name: 'Добавить файл' })).toHaveCount(0);
    await expect(vera.page.getByRole('button', { name: /^В корзину/ })).toHaveCount(0);
    await expect(
      fileRows(vera.page)
        .first()
        .getByRole('link', { name: /^Скачать/ }),
    ).toBeVisible();
    await checkApp(vera.page, info, 'files-child');
  } finally {
    await vera.close();
  }
});

test('заметка: раздел «Файлы» в карточке, загрузка PDF и фото', async ({ page, family }, info) => {
  const boris = await apiAs(family, 'adult');
  const note = await seedNote(boris, family, {
    title: 'Поверка счётчиков',
    body: 'Сдать до 25-го.',
  });
  await signInAs(page, family, 'adult');
  await page.goto(`#/more/notes/${note.id}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Поверка счётчиков' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Файлы', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Файлов пока нет' })).toBeVisible();
  await checkApp(page, info, 'notes-files-empty');

  await filePicker(page).setInputFiles([
    { name: RECEIPT, mimeType: PDF_MIME, buffer: PDF },
    { name: PHOTO, mimeType: PNG_MIME, buffer: makePng(800, 600) },
  ]);
  await expect(fileRows(page)).toHaveCount(2);
  await expectImageLoaded(page, '.file-row__image');
  await checkApp(page, info, 'notes-files');

  const stored = await family.database.admin.query(
    'SELECT title, mime_type FROM note_files ORDER BY mime_type',
  );
  expect(stored.rows).toEqual([
    { title: RECEIPT, mime_type: 'application/pdf' },
    { title: PHOTO, mime_type: 'image/png' },
  ]);
  await expectNothingStored(page, ['Квитанция', 'Фото счётчика', 'Поверка']);
});

test('файл объекта «Взрослые» не открывается ребёнку ни на экране, ни прямым запросом', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, {
    title: 'Договор аренды',
    objectType: 'property',
    audience: 'adults',
  });
  const secret = await attach(boris, 'objects', object.id, 'Паспорт жильца.pdf', PDF, PDF_MIME);
  const photo = await attach(boris, 'objects', object.id, PHOTO, makePng(320, 240), PNG_MIME);

  // Взрослый видит и открывает.
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(fileRows(page)).toHaveCount(2);

  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto(`#/home/${object.id}/files`);
    await expect(
      vera.page.getByText('Объекта больше нет, или он стал вам недоступен'),
    ).toBeVisible();
    await expect(vera.page.getByText('Паспорт жильца')).toHaveCount(0);
    await expect(vera.page.getByText('Договор аренды')).toHaveCount(0);
    await expect(filePicker(vera.page)).toHaveCount(0);
    await checkApp(vera.page, info, 'files-adults-child');

    const api = await apiAs(family, 'child');
    for (const path of [`files/${secret}`, `files/${photo}/preview`, `files/${photo}`]) {
      const response = await api.raw(path);
      expect(response.status, path).toBe(404);
      expect((await response.text()).length, path).toBeLessThan(200);
    }
    expect((await api.get(`objects/${object.id}/files`)).status).toBe(404);
    expect(
      (await api.upload(`objects/${object.id}/files`, { name: 'a.pdf', type: PDF_MIME, data: PDF }))
        .status,
    ).toBe(404);
    // Взрослому тот же адрес отдаёт файл, а не отказ.
    expect((await boris.raw(`files/${secret}`)).status).toBe(200);
  } finally {
    await vera.close();
  }
});
