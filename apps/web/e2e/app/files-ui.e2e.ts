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

// Экраны файлов, часть 2 (R0.5f): фото профиля, удалённые файлы после перезагрузки, файлы в
// «Корзине», PDF на экране, конфликт события и доработки по ревью PR #19. Семья вымышленная:
// Анна — администратор, Борис — взрослый, Вера — ребёнок. Файлы создаются в самих тестах.

const toast = (page: Page) => page.locator('.toast-region');
const PHOTO = 'Мой портрет.png';
const OTHER_PHOTO = 'Второй портрет.png';
const RECEIPT = 'Квитанция за воду.pdf';
const SNAPSHOT = 'Фото счётчика.png';

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

async function uploadPhoto(api: Api, name: string, width: number, height: number) {
  const answer = await api.upload('me/profile/photo', {
    name,
    type: PNG_MIME,
    data: makePng(width, height),
  });
  if (answer.status !== 201) throw new Error(`Test photo was not uploaded: ${answer.status}`);
  return (answer.body as { id: string }).id;
}

const previous = (page: Page) => page.getByRole('list', { name: 'Прежние фото' });
const memberPhoto = '.member-head .avatar__photo';

test('фото профиля: загрузить, сменить, снять и вернуть; семья видит фото, детали — только владельцу', async ({
  page,
  family,
  browser,
}, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/profile');
  await expect(page.getByRole('heading', { level: 1, name: 'Обо мне' })).toBeVisible();
  await expect(page.getByText('Фото загружать пока нельзя')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible();
  await expect(page.locator(memberPhoto)).toHaveCount(0);
  await checkApp(page, info, 'profile-photo-empty');

  // Не картинка: объяснение до отправки, запрос не уходит.
  const uploads: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/profile/photo'))
      uploads.push(request.url());
  });
  await filePicker(page).setInputFiles({ name: RECEIPT, mimeType: PDF_MIME, buffer: PDF });
  await expect(page.getByRole('alert')).toContainText('Для фото профиля нужна картинка');
  expect(uploads).toHaveLength(0);

  // Загрузка: фото появляется в шапке, прежних фото пока нет.
  await filePicker(page).setInputFiles({
    name: PHOTO,
    mimeType: PNG_MIME,
    buffer: makePng(1200, 800),
  });
  await expect(page.getByRole('button', { name: 'Сменить фото' })).toBeVisible();
  await expectImageLoaded(page, memberPhoto);
  await expect(toast(page)).toContainText('Фото обновлено');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(previous(page)).toHaveCount(0);
  await checkApp(page, info, 'profile-photo');

  // Смена: прежнее фото уходит в «Прежние фото».
  await filePicker(page).setInputFiles({
    name: OTHER_PHOTO,
    mimeType: PNG_MIME,
    buffer: makePng(900, 900),
  });
  await expect(previous(page).getByRole('listitem')).toHaveCount(1);
  await expectImageLoaded(page, memberPhoto);
  await expectImageLoaded(page, '.file-trash .file-row__image');
  await checkApp(page, info, 'profile-photo-previous');

  // Другие участники видят текущее фото в «Люди» и в карточке участника.
  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto('#/people');
    const row = vera.page
      .getByRole('list', { name: 'Участники дома' })
      .getByRole('listitem')
      .filter({ hasText: 'Борис' });
    await expect(row).toBeVisible();
    await expectImageLoaded(vera.page, '.row .avatar__photo');
    await expect(row.locator('.avatar__photo')).toHaveCount(1);
    await checkApp(vera.page, info, 'people-photo');
    await vera.page.goto(`#/people/members/${family.person('adult').id}`);
    await expect(vera.page.getByRole('heading', { level: 1, name: 'Борис' })).toBeVisible();
    await expectImageLoaded(vera.page, memberPhoto);
    await checkApp(vera.page, info, 'member-photo');
    // Прежние фото видит только владелец: у Веры такого раздела нет.
    await vera.page.goto('#/more/profile');
    await expect(vera.page.getByRole('list', { name: 'Прежние фото' })).toHaveCount(0);
  } finally {
    await vera.close();
  }

  // Снять фото: в шапке снова буква, фото попадает в «Прежние фото».
  await page.getByRole('button', { name: 'Убрать фото' }).click();
  await expect(toast(page)).toContainText('Фото снято');
  await expect(page.locator(memberPhoto)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Загрузить фото' })).toBeVisible();
  await expect(previous(page).getByRole('listitem')).toHaveCount(2);
  await checkApp(page, info, 'profile-photo-removed');

  // «Отменить» в течение 7 секунд возвращает снятое фото.
  await toast(page).getByRole('button', { name: 'Отменить' }).click();
  await expect(toast(page)).toContainText('Фото возвращено');
  await expectImageLoaded(page, memberPhoto);
  await expect(previous(page).getByRole('listitem')).toHaveCount(1);

  // Вернуть одно из прежних фото: оно становится текущим, текущее — прежним.
  await previous(page)
    .getByRole('button', { name: /^Вернуть фото/ })
    .click();
  await expect(toast(page)).toContainText('Фото возвращено');
  await expect(previous(page).getByRole('listitem')).toHaveCount(1);
  await expectImageLoaded(page, memberPhoto);

  // Имя файла не попало ни в адрес, ни в хранилища браузера.
  await expectNothingStored(page, [PHOTO, OTHER_PHOTO, 'Мой портрет', 'blob:']);
});

test('фото профиля видит действующая семья; бывший участник после ухода семейных фото не видит', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const vera = await apiAs(family, 'child');
  const borisPhoto = await uploadPhoto(boris, 'Портрет Бориса.png', 600, 400);
  const veraPhoto = await uploadPhoto(vera, 'Портрет Веры.png', 500, 500);

  // Пока оба в доме, они видят фото друг друга; чужого превью без дома нет.
  expect((await vera.raw(`files/${borisPhoto}/preview`)).status).toBe(200);
  expect((await boris.raw(`files/${veraPhoto}/preview`)).status).toBe(200);
  expect((await boris.raw(`files/${veraPhoto}`)).status).toBe(200);

  const left = await boris.post(`households/${family.houseId}/leave`, {});
  expect(left.status).toBe(200);

  // Бывший участник не видит фото семьи, семья — его фото; свои фото владелец видит.
  for (const path of [`files/${veraPhoto}/preview`, `files/${veraPhoto}`]) {
    const response = await boris.raw(path);
    expect(response.status, path).toBe(404);
    expect((await response.text()).length, path).toBeLessThan(200);
  }
  expect((await vera.raw(`files/${borisPhoto}/preview`)).status).toBe(404);
  expect((await boris.raw(`files/${borisPhoto}/preview`)).status).toBe(200);

  // На экране: у бывшего участника в списке только буква, у него самого нет ни дома, ни чужих фото.
  const watcher = await openAs(browser, family, info, 'child');
  try {
    await watcher.page.goto('#/people');
    const former = watcher.page.getByRole('list', { name: 'Бывшие участники' });
    await expect(former).toContainText('Борис');
    await expect(former.locator('.avatar__photo')).toHaveCount(0);
    await expect(
      watcher.page
        .getByRole('list', { name: 'Участники дома' })
        .getByRole('listitem')
        .filter({ hasText: 'Вера' })
        .locator('.avatar__photo'),
    ).toHaveCount(1);
    await checkApp(watcher.page, info, 'people-former-photo');
  } finally {
    await watcher.close();
  }
  await signInAs(page, family, 'adult');
  await page.goto('#/people');
  await expect(page.getByText('Вы не состоите в доме')).toBeVisible();
  await expect(page.locator('.avatar__photo')).toHaveCount(0);
  await checkApp(page, info, 'people-left');
});

test('удалённые файлы объекта и заметки видны после перезагрузки; вернуть может автор-взрослый', async ({
  page,
  family,
  browser,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  const note = await seedNote(boris, family, {
    title: 'Поверка счётчиков',
    body: 'Сдать до 25-го.',
    audience: 'household',
  });
  await attach(boris, 'objects', object.id, SNAPSHOT, makePng(640, 480), PNG_MIME);
  const receipt = await attach(boris, 'objects', object.id, RECEIPT, PDF, PDF_MIME);
  const noteFile = await attach(boris, 'notes', note.id, 'Акт поверки.pdf', PDF, PDF_MIME);
  expect((await boris.post(`objects/${object.id}/files/${receipt}/trash`, {})).status).toBe(200);
  expect((await boris.post(`notes/${note.id}/files/${noteFile}/trash`, {})).status).toBe(200);

  // Файл убрали раньше и в другом сеансе: «Удалённые файлы» берутся с сервера, а не из памяти.
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(fileRows(page)).toHaveCount(1);
  const removed = page.getByRole('list', { name: 'Удалённые файлы' });
  await expect(removed).toContainText(RECEIPT);
  await expect(removed.getByRole('button', { name: /^Восстановить/ })).toBeVisible();
  await checkApp(page, info, 'files-deleted-reload');
  await page.reload();
  await expect(removed).toContainText(RECEIPT);

  await removed.getByRole('button', { name: /^Восстановить/ }).click();
  await expect(toast(page)).toContainText('Файл возвращён');
  await expect(removed).toHaveCount(0);
  await expect(fileRows(page)).toHaveCount(2);

  // Новое удаление: подсказка в уведомлении верна и после перезагрузки.
  await fileRows(page)
    .filter({ hasText: RECEIPT })
    .getByRole('button', { name: /^В корзину/ })
    .click();
  await expect(toast(page)).toContainText('Файл в корзине');
  await expect(removed).toContainText(RECEIPT);
  await page.reload();
  await expect(removed).toContainText(RECEIPT);

  // Заметка: то же самое в карточке.
  await page.goto(`#/more/notes/${note.id}`);
  const noteRemoved = page.getByRole('list', { name: 'Удалённые файлы' });
  await expect(noteRemoved).toContainText('Акт поверки.pdf');
  await expect(noteRemoved.getByRole('button', { name: /^Восстановить/ })).toBeVisible();
  await checkApp(page, info, 'notes-files-deleted');

  // Вера видит удалённый файл общего объекта, но вернуть его не может.
  const vera = await openAs(browser, family, info, 'child');
  try {
    await vera.page.goto(`#/home/${object.id}/files`);
    const list = vera.page.getByRole('list', { name: 'Удалённые файлы' });
    await expect(list).toContainText(RECEIPT);
    await expect(list.getByRole('button', { name: /^Восстановить/ })).toHaveCount(0);
    await expect(list).toContainText(
      'Вернуть этот файл может его автор-взрослый или администратор.',
    );
    await checkApp(vera.page, info, 'files-deleted-child');
  } finally {
    await vera.close();
  }
  await expectNothingStored(page, [RECEIPT, SNAPSHOT, 'Акт поверки', 'Квитанция']);
});

test('«Корзина»: удалённые файлы рядом с заметками и объектами, восстановление и снятые фото', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  const note = await seedNote(boris, family, {
    title: 'Поверка счётчиков',
    audience: 'household',
  });
  const receipt = await attach(boris, 'objects', object.id, RECEIPT, PDF, PDF_MIME);
  const snapshot = await attach(boris, 'notes', note.id, SNAPSHOT, makePng(400, 300), PNG_MIME);
  await boris.post(`objects/${object.id}/files/${receipt}/trash`, {});
  await boris.post(`notes/${note.id}/files/${snapshot}/trash`, {});
  const first = await uploadPhoto(boris, PHOTO, 300, 300);
  await uploadPhoto(boris, OTHER_PHOTO, 320, 320);
  expect(first).not.toBe('');

  await signInAs(page, family, 'adult');
  await page.goto('#/more/trash');
  await expect(page.getByRole('heading', { level: 1, name: 'Корзина' })).toBeVisible();
  const files = page.getByRole('list', { name: 'Удалённые файлы' });
  await expect(files.getByRole('listitem')).toHaveCount(3);
  await expect(files).toContainText(RECEIPT);
  await expect(files).toContainText(SNAPSHOT);
  await expect(files).toContainText('из объекта');
  await expect(files).toContainText('из заметки');
  await expect(files).toContainText('фото профиля');
  await expect(page.getByRole('heading', { level: 2, name: 'Файлы' })).toBeVisible();
  await checkApp(page, info, 'trash-files');

  // Переход к записи и возврат файла из «Корзины».
  await files
    .getByRole('listitem')
    .filter({ hasText: RECEIPT })
    .getByRole('link', { name: 'К объекту' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Квартира у парка' })).toBeVisible();
  await page.goto('#/more/trash');
  await files
    .getByRole('listitem')
    .filter({ hasText: RECEIPT })
    .getByRole('button', { name: /^Восстановить файл/ })
    .click();
  await expect(toast(page)).toContainText('Файл возвращён');
  await expect(files.getByRole('listitem')).toHaveCount(2);

  // Прежнее фото возвращается текущим, а текущее само уходит в корзину: число строк прежнее.
  await files
    .getByRole('listitem')
    .filter({ hasText: 'фото профиля' })
    .first()
    .getByRole('button', { name: /^Восстановить файл/ })
    .click();
  await expect(toast(page)).toContainText('Это фото снова ваше текущее фото профиля');
  await expect(files.getByRole('listitem')).toHaveCount(2);
  await checkApp(page, info, 'trash-files-restored');

  await page.goto(`#/home/${object.id}/files`);
  await expect(fileRows(page).filter({ hasText: RECEIPT })).toHaveCount(1);
  await expectNothingStored(page, [RECEIPT, SNAPSHOT, PHOTO, OTHER_PHOTO]);
});

test('пустая «Корзина» говорит и про файлы', async ({ page, family }, info) => {
  await signInAs(page, family, 'adult');
  await page.goto('#/more/trash');
  const empty = page.getByRole('region', { name: 'В корзине пусто' });
  await expect(empty).toContainText('Удалённые заметки, объекты и файлы');
  await checkApp(page, info, 'trash-empty');
});
test('подготовка фото: WebP не теряет прозрачность, а если уменьшенное не меньше — уходит исходное', async ({
  page,
  family,
}) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(page.getByRole('button', { name: 'Добавить файл' })).toBeVisible();

  // Широкий WebP с прозрачным фоном и непрозрачным пятном: рисуем его в самом браузере.
  const webp = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200;
    canvas.height = 1800;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas');
    for (let step = 0; step < 400; step += 1) {
      context.fillStyle = `rgb(${(step * 7) % 256} ${(step * 13) % 256} ${(step * 29) % 256})`;
      context.fillRect(1400 + ((step * 37) % 1700), 200 + ((step * 53) % 1300), 90, 70);
    }
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/webp', 1));
    if (blob === null || blob.type !== 'image/webp') throw new Error('No WebP encoder');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text);
  });
  await filePicker(page).setInputFiles({
    name: 'Схема.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from(webp, 'base64'),
  });
  await expect(fileRows(page)).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Загрузка файлов' })).toHaveCount(0);
  const stored = (await boris.get(`objects/${object.id}/files`)).body as {
    id: string;
    mimeType: string;
    name: string;
  }[];
  expect(stored).toHaveLength(1);
  expect(stored[0]?.mimeType).toBe('image/webp');
  expect(stored[0]?.name).toBe('Схема.webp');
  const served = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'same-origin' });
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas');
    context.drawImage(bitmap, 0, 0);
    // Угол картинки не рисовался: он остаётся прозрачным, только если прозрачность не потеряна.
    const corner = context.getImageData(2, 2, 1, 1).data[3];
    return {
      width: bitmap.width,
      height: bitmap.height,
      corner,
      type: response.headers.get('content-type'),
    };
  }, `/api/files/${stored[0]?.id}`);
  expect(Math.max(served.width, served.height)).toBeLessThanOrEqual(2560);
  expect(served.type).toBe('image/webp');
  expect(served.corner).toBe(0);

  // Снимок, который после уменьшения стал бы больше (ровные полосы сжимаются лучше), уходит как есть.
  await filePicker(page).setInputFiles({
    name: 'Полосы.png',
    mimeType: PNG_MIME,
    buffer: makePng(3200, 1800),
  });
  await expect(fileRows(page)).toHaveCount(2);
  const files = (await boris.get(`objects/${object.id}/files`)).body as {
    id: string;
    name: string;
  }[];
  const stripes = files.find((file) => file.name === 'Полосы.png');
  const size = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'same-origin' });
    const bitmap = await createImageBitmap(await response.blob());
    return { width: bitmap.width, height: bitmap.height };
  }, `/api/files/${stripes?.id}`);
  expect(size).toEqual({ width: 3200, height: 1800 });
});

test('PDF на экране: «Открыть» ведёт на ?inline=1 в новой вкладке, скачивание остаётся', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  const receipt = await attach(boris, 'objects', object.id, RECEIPT, PDF, PDF_MIME);
  await attach(boris, 'objects', object.id, SNAPSHOT, makePng(320, 240), PNG_MIME);
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/files`);
  await expect(fileRows(page)).toHaveCount(2);

  const row = fileRows(page).filter({ hasText: RECEIPT });
  const open = row.getByRole('link', { name: /^Открыть PDF/ });
  await expect(open).toHaveAttribute('href', `/api/files/${receipt}?inline=1`);
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', /noopener/);
  await expect(row.getByRole('link', { name: /^Скачать/ })).toHaveAttribute(
    'href',
    `/api/files/${receipt}`,
  );
  // У фото «Открыть» остаётся просмотром на экране, ссылки на PDF у него нет.
  await expect(
    fileRows(page)
      .filter({ hasText: SNAPSHOT })
      .getByRole('link', { name: /^Открыть PDF/ }),
  ).toHaveCount(0);
  await checkApp(page, info, 'files-pdf');

  // Сервер отдаёт PDF «на экран», с песочницей без разрешений и только после проверки доступа.
  const served = await page.evaluate(async (url) => {
    const response = await fetch(url, { credentials: 'same-origin' });
    return {
      status: response.status,
      disposition: response.headers.get('content-disposition'),
      policy: response.headers.get('content-security-policy'),
      cache: response.headers.get('cache-control'),
      body: await response.text(),
    };
  }, `/api/files/${receipt}?inline=1`);
  expect(served.status).toBe(200);
  expect(served.disposition).toMatch(/^inline/);
  expect(served.policy).toBe('sandbox');
  expect(served.cache).toContain('no-store');
  expect(served.body).toContain('%PDF');
  // Новая вкладка открывается тем же адресом.
  const [popup] = await Promise.all([page.waitForEvent('popup'), open.click()]);
  await popup.close();
  await expectNothingStored(page, [RECEIPT, 'Квитанция']);
});

test('конфликт события: выбор «Обновить» или «Сохранить мою версию», чужая правка не затирается', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await sharedObject(boris, family);
  const created = await boris.post(`objects/${object.id}/events`, {
    occurredOn: '2026-10-02',
    text: 'Заменили смеситель',
    amountKopecks: 184_050,
    rating: 4,
  });
  expect(created.status).toBe(201);
  const event = created.body as { id: string };
  await signInAs(page, family, 'adult');
  await page.goto(`#/home/${object.id}/timeline`);
  const timeline = page.getByRole('list', { name: 'Лента объекта' });
  await expect(timeline).toContainText('Заменили смеситель');

  const texts = async () =>
    (
      (await boris.get(`objects/${object.id}/timeline`)).body as {
        items: { source: string; text?: string }[];
      }
    ).items
      .filter((item) => item.source === 'manual')
      .map((item) => item.text);

  // Событие правят в двух местах: сервер принимает правку из другого окна первой.
  await timeline.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Что произошло').fill('Заменили смеситель и сифон (моя правка)');
  const other = await boris.patch(`objects/${object.id}/events/${event.id}`, {
    text: 'Заменили смеситель в ванной',
  });
  expect(other.status).toBe(200);
  const form = page.locator('form.event-form');
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Событие изменили, пока вы его правили.');
  await expect(form.getByRole('button', { name: 'Обновить' })).toBeVisible();
  await checkApp(page, info, 'event-conflict');

  // Повторное «Сохранить» не перезаписывает чужую правку молча: конфликт остаётся.
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Событие изменили, пока вы его правили.');
  expect(await texts()).toEqual(['Заменили смеситель в ванной']);

  // «Обновить» берёт версию сервера, введённое пропадает.
  await form.getByRole('button', { name: 'Обновить' }).click();
  await expect(form).toHaveCount(0);
  await expect(timeline).toContainText('Заменили смеситель в ванной');
  await expect(timeline).not.toContainText('моя правка');

  // Второй раунд: «Сохранить мою версию отдельным событием» добавляет запись, исходная цела.
  await timeline.getByRole('button', { name: 'Править' }).click();
  await page.getByLabel('Что произошло').fill('Заменили смеситель и сифон (моя версия)');
  await boris.patch(`objects/${object.id}/events/${event.id}`, {
    text: 'Смеситель заменила бригада',
  });
  await form.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await form.getByRole('button', { name: 'Сохранить мою версию отдельным событием' }).click();
  await expect(toast(page)).toContainText('Ваша версия сохранена отдельным событием');
  await expect(form).toHaveCount(0);
  await expect(timeline).toContainText('Смеситель заменила бригада');
  await expect(timeline).toContainText('Заменили смеситель и сифон (моя версия)');
  expect((await texts()).sort()).toEqual(
    ['Заменили смеситель и сифон (моя версия)', 'Смеситель заменила бригада'].sort(),
  );
});

test('объекты: текст «Восстановить», «Кто видит» по типу, отступ полей от «Изменён»', async ({
  page,
  family,
}, info) => {
  const boris = await apiAs(family, 'adult');
  const object = await seedObject(boris, family, {
    title: 'Квартира у парка',
    objectType: 'property',
    audience: 'household',
    fields: [{ name: 'Площадь', value: '54 м²' }],
  });
  await signInAs(page, family, 'adult');

  // Свои поля не прижаты к строке «Изменён».
  await page.goto(`#/home/${object.id}`);
  const lastFact = page.locator('dl.facts').first().locator('.facts__item').last();
  await expect(lastFact).toContainText('Изменён');
  const fieldsTitle = page.getByRole('heading', { level: 2, name: 'Свои поля' });
  const factBox = await lastFact.boundingBox();
  const titleBox = await fieldsTitle.boundingBox();
  expect(factBox && titleBox && titleBox.y - (factBox.y + factBox.height)).toBeGreaterThanOrEqual(
    16,
  );
  await checkApp(page, info, 'object-overview-spacing');

  // Отказ при восстановлении говорит про восстановление, а не про корзину.
  await page.getByRole('button', { name: 'В корзину' }).click();
  await expect(toast(page)).toContainText('Объект в корзине');
  await page.goto(`#/home/${object.id}`);
  await expect(page.getByText('Объект в корзине.')).toBeVisible();
  await page.route('**/api/objects/*/restore', (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"FORBIDDEN"}' }),
  );
  await page.getByRole('button', { name: 'Восстановить' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Вернуть общий объект из корзины');
  await expect(alert).not.toContainText('Убрать общий объект в корзину');
  await page.unroute('**/api/objects/*/restore');

  // «Кто видит» следует за типом, пока человек не выбрал сам; выбранное тип не перетирает.
  await page.goto('#/home/new');
  const visibility = page.locator('form.object-form').getByRole('group', { name: 'Кто видит' });
  for (const type of ['Машина', 'Техника', 'Другое', 'Недвижимость']) {
    await page.locator('form.object-form').getByRole('radio', { name: type }).check();
    await expect(visibility.getByRole('radio', { name: 'Взрослые' })).toBeChecked();
  }
  await visibility.getByRole('radio', { name: 'Только я' }).check();
  await page.locator('form.object-form').getByRole('radio', { name: 'Машина' }).check();
  await expect(visibility.getByRole('radio', { name: 'Только я' })).toBeChecked();
});
