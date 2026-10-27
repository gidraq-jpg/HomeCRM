import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { AiStatus, DOCUMENT_LABELS, DocumentDraft, DraftSchemas } from '@homecrm/shared';
import type { Page } from '@playwright/test';
import { identityPage, meterPage } from '../../../server/src/ai/eval/inbox.ts';
import { fakeDraft } from '../../../server/src/ai/providers.ts';
import type { Family } from '../auth/support/family.ts';
import { test } from '../auth/support/fixtures.ts';
import { apiAs } from './notes-support.ts';
import { checkApp, expect, openSection, signInAs } from './support.ts';

async function enable(family: Family) {
  await family.database.admin.query('UPDATE spaces SET ai_enabled=true WHERE id=$1', [
    family.houseId,
  ]);
}

for (const sample of ['receipt-text', 'receipt-scan', 'contract', 'encrypted', 'broken'])
  test(`AI-9: PDF ${sample} → черновик или ручной ввод`, async ({ page, family }, info) => {
    await enable(family);
    await signInAs(page, family, 'adult');
    await openCapture(page);
    await page.getByLabel('Галерея или файл — можно несколько страниц').setInputFiles({
      name: 'Учебное вложение.pdf',
      mimeType: 'application/pdf',
      buffer: await readFile(
        new URL(`../../../server/src/ai/eval/samples/pdf/${sample}.pdf`, import.meta.url),
      ),
    });
    await page.getByRole('button', { name: 'Во входящие', exact: true }).click();
    await page.getByRole('button', { name: 'Согласен, разобрать', exact: true }).click();
    const error = sample === 'encrypted' || sample === 'broken';
    await expect(
      page.getByText(error ? 'Не удалось разобрать — можно заполнить вручную' : 'Черновик готов', {
        exact: true,
      }),
    ).toBeVisible({ timeout: 20000 });
    await page.getByRole('link', { name: 'Открыть', exact: true }).first().click();
    if (sample === 'encrypted')
      await expect(page.getByText('PDF защищён паролем.', { exact: false })).toBeVisible();
    if (sample === 'broken')
      await expect(page.getByText('Не удалось прочитать PDF:', { exact: false })).toBeVisible();
    if (sample === 'contract')
      await expect(
        page.getByText('Разобраны первые 5 страниц из 8.', { exact: false }),
      ).toBeVisible();
    await checkApp(page, info, `inbox-pdf-${sample}`);
    if (error) {
      await page.getByRole('link', { name: 'Изменить', exact: true }).click();
      await page.getByLabel('Заголовок', { exact: true }).fill('Учебный ручной ввод PDF');
      await checkApp(page, info, `inbox-pdf-${sample}-manual`);
      await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
      await expect(page.getByText('Здесь пока пусто.', { exact: false })).toBeVisible();
      expect((await family.database.admin.query('SELECT id FROM note_files')).rowCount).toBe(1);
    }
  });
async function openCapture(page: Page) {
  // Готовность ИИ проверяют следующие шаги согласия: ответ предзагрузки может прийти до перехода.
  await openSection(page, '/more/inbox/new', 'Входящие');
  await expect(page.locator('.inbox-capture')).toHaveAttribute('aria-busy', 'false');
}

test('D32: задержка настройки ИИ не позволяет отправить входящее без согласия', async ({
  page,
  family,
}) => {
  await enable(family);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/ai/status?**', async (route) => {
    await gate;
    await route.continue();
  });
  let posted = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/inbox') posted++;
  });
  try {
    await signInAs(page, family, 'adult');
    await openSection(page, '/more/inbox/new', 'Входящие');
    const form = page.locator('.inbox-capture');
    await expect(form).toHaveAttribute('aria-busy', 'true');
    await page.getByLabel('Текст или диктовка').fill('Вымышленный черновик до настройки');
    const send = page.getByRole('button', { name: 'Во входящие', exact: true });
    await expect(send).toBeDisabled();
    await form.evaluate((node) => (node as HTMLFormElement).requestSubmit());
    expect(posted).toBe(0);
    release();
    await expect(form).toHaveAttribute('aria-busy', 'false');
    await send.click();
    await expect(
      page.getByRole('button', { name: 'Согласен, разобрать', exact: true }),
    ).toBeVisible();
    expect(posted).toBe(0);
  } finally {
    release();
  }
});
async function capture(page: Page, text: string) {
  await openCapture(page);
  await page.getByLabel('Текст или диктовка').fill(text);
  await page.getByRole('button', { name: 'Во входящие', exact: true }).click();
  const consent = page.getByRole('button', { name: 'Согласен, разобрать', exact: true });
  await consent.click();
  await expect(page.getByText('Черновик готов', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Открыть', exact: true }).first().click();
}
test('INBOX-1/2/4: во входящие → app fake → сохранить как предложено', async ({
  page,
  family,
}, info) => {
  await page.route(
    '**/api/ai/status?**',
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    },
    { times: 1 },
  );
  await enable(family);
  await signInAs(page, family, 'adult');
  await capture(page, 'Позвонить в учебную мастерскую');
  await checkApp(page, info, 'inbox-ready');
  await page.getByRole('button', { name: 'Сохранить как предложено', exact: true }).click();
  await expect(page.getByText('Здесь пока пусто.', { exact: false })).toBeVisible();
  expect(
    (await family.database.admin.query('SELECT title FROM tasks')).rows.map((r) => r.title),
  ).toContain('Позвонить в учебную мастерскую');
});
test('INBOX-4: Изменить открывает обычную форму, исправленные поля сохраняются', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await capture(page, 'Позвонить в учебную мастерскую');
  await page.getByRole('link', { name: 'Изменить', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Новая запись: Дело', exact: true }),
  ).toBeVisible();
  await page.getByLabel('Название дела', { exact: true }).fill('Учебная исправленная задача');
  await checkApp(page, info, 'inbox-edit-task');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Здесь пока пусто.', { exact: false })).toBeVisible();
  expect(
    (await family.database.admin.query('SELECT title FROM tasks')).rows.map((r) => r.title),
  ).toContain('Учебная исправленная задача');
});
test('AI-4: фото документа личности → пустая ручная форма → файл документа', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await openCapture(page);
  const bytes = await identityPage();
  await page
    .getByLabel('Галерея или файл — можно несколько страниц')
    .setInputFiles({ name: 'Учебный документ.png', mimeType: 'image/png', buffer: bytes });
  await page.getByRole('button', { name: 'Во входящие', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать', exact: true }).click();
  await expect(
    page.getByText('Документ личности — заполните вручную', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: 'Заполнить вручную', exact: true }).click();
  await page.getByRole('link', { name: 'Заполнить вручную', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Номер', { exact: true })).toHaveValue('');
  await checkApp(page, info, 'inbox-identity-manual');
  await page.getByLabel('Название', { exact: true }).fill('Учебный документ вручную');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByText('Здесь пока пусто.', { exact: false })).toBeVisible();
  expect((await family.database.admin.query('SELECT draft FROM inbox_items')).rows).toEqual([
    { draft: null },
  ]);
  expect((await family.database.admin.query('SELECT id FROM document_files')).rowCount).toBe(1);
});
test('INBOX-3: карточка нового объекта → обычная форма → привязка', async ({
  page,
  family,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await capture(page, 'Заметка: новый объект: Учебный насос; гарантия лежит в ящике');
  await page.getByRole('link', { name: 'Создать объект', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Учебный насос');
  await checkApp(page, info, 'inbox-new-object');
  await page.getByRole('button', { name: 'Создать объект', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Входящее', exact: true })).toBeVisible();
  expect(
    (await family.database.admin.query('SELECT title FROM objects')).rows.map((r) => r.title),
  ).toContain('Учебный насос');
  const row = (await family.database.admin.query('SELECT draft FROM inbox_items')).rows[0];
  expect(row.draft.classification.newObject).toBeNull();
  expect(row.draft.classification.objectId.value).toBeTruthy();
});
test('INBOX-1: офлайн-захват → очередь → отправка без дубликата', async ({
  page,
  family,
  context,
}, info) => {
  await enable(family);
  await signInAs(page, family, 'adult');
  await openCapture(page);
  await context.setOffline(true);
  await page.getByLabel('Текст или диктовка').fill('Учебная мысль без сети');
  await page.getByRole('button', { name: 'Во входящие', exact: true }).click();
  await page.getByRole('button', { name: 'Согласен, разобрать', exact: true }).click();
  await expect(page.getByText('Сохранено на устройстве.', { exact: false })).toBeVisible();
  await checkApp(page, info, 'inbox-offline');
  await context.setOffline(false);
  await expect(page.getByText('Учебная мысль без сети', { exact: true })).toBeVisible({
    timeout: 20000,
  });
  expect((await family.database.admin.query('SELECT id FROM inbox_items')).rowCount).toBe(1);
  await expect(page.getByText('Черновик готов', { exact: true })).toBeVisible({ timeout: 20000 });
});

for (const mixed of [false, true])
  test(`AI-5: ${mixed ? 'покупка и заметка — фото у заметки' : 'покупка — предупреждение и удаление фото'}`, async ({
    page,
    family,
  }, info) => {
    await enable(family);
    await signInAs(page, family, 'adult');
    await openCapture(page);
    await page
      .getByLabel('Текст или диктовка')
      .fill(
        mixed
          ? 'Купить учебный блокнот и заметка: гарантия насоса в ящике'
          : 'Купить учебный блокнот',
      );
    await page.getByLabel('Галерея или файл — можно несколько страниц').setInputFiles({
      name: 'Учебное фото.png',
      mimeType: 'image/png',
      buffer: await meterPage(),
    });
    await page.getByRole('button', { name: 'Во входящие', exact: true }).click();
    await page.getByRole('button', { name: 'Согласен, разобрать', exact: true }).click();
    await expect(page.getByText('Черновик готов', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('link', { name: 'Открыть', exact: true }).click();
    if (!mixed) await expect(page.getByText('Фото не сохранится', { exact: true })).toBeVisible();
    else
      await expect(
        page.getByRole('heading', { name: 'Также сохранится', exact: true }),
      ).toBeVisible();
    await checkApp(page, info, mixed ? 'inbox-mixed' : 'inbox-shopping-photo');
    await page.getByRole('button', { name: 'Сохранить как предложено', exact: true }).click();
    await expect(page.getByText('Здесь пока пусто.', { exact: false })).toBeVisible();
    expect((await family.database.admin.query('SELECT id FROM shopping_items')).rowCount).toBe(1);
    expect((await family.database.admin.query('SELECT id FROM inbox_files')).rowCount).toBe(0);
    expect((await family.database.admin.query('SELECT id FROM note_files')).rowCount).toBe(
      mixed ? 1 : 0,
    );
  });

for (const automatic of [true, false])
  test(`INBOX-2: ${automatic ? 'новое разбирается при открытии входящих' : 'без согласия ждёт кнопки Разобрать'}`, async ({
    page,
    family,
  }, info) => {
    await enable(family);
    const api = await apiAs(family, 'adult');
    const status = AiStatus.parse((await api.get(`ai/status?spaceId=${family.houseId}`)).body);
    const id = randomUUID();
    expect(
      (
        await api.post('inbox', {
          id,
          idempotencyKey: id,
          ownerAccountId: family.person('adult').id,
          offline: true,
          source: 'text',
          text: 'Заметка: учебный код калитки 0000',
          houseId: family.houseId,
          consent: automatic ? `v4:${status.provider}` : null,
        })
      ).status,
    ).toBe(201);
    await signInAs(page, family, 'adult');
    expect(
      (await family.database.admin.query('SELECT status FROM inbox_items WHERE id=$1', [id]))
        .rows[0].status,
    ).toBe('new');
    await openSection(page, '/more/inbox', 'Входящие');
    if (!automatic) {
      await page.getByRole('link', { name: 'Открыть', exact: true }).click();
      await page.getByRole('button', { name: 'Разобрать', exact: true }).click();
      await page.getByRole('button', { name: 'Согласен, разобрать', exact: true }).click();
    }
    await expect(page.getByText('Черновик готов', { exact: true })).toBeVisible({ timeout: 20000 });
    await checkApp(page, info, automatic ? 'inbox-reopen' : 'inbox-parse-button');
  });

test('INBOX-4: предпросмотр показывает рубли, русские даты, тип и все сопутствующие покупки', async ({
  page,
  family,
}, info) => {
  const api = await apiAs(family, 'adult');
  await signInAs(page, family, 'adult');
  for (const kind of ['document', 'receipt'] as const) {
    const id = randomUUID();
    expect(
      (
        await api.post('inbox', {
          id,
          idempotencyKey: id,
          ownerAccountId: family.person('adult').id,
          offline: true,
          source: 'text',
          text: 'Учебная карточка формата',
          houseId: family.houseId,
        })
      ).status,
    ).toBe(201);
    const raw = fakeDraft({
      kind,
      text: 'Учебный образец',
      context: { objects: [], members: [], timeZone: 'Asia/Yekaterinburg' },
    });
    const fields =
      kind === 'document'
        ? { ...DocumentDraft.parse(raw), issuedOn: { value: '2026-10-05', confident: true } }
        : DraftSchemas.receipt.parse(raw);
    const purchases = [
      {
        title: { value: 'Учебная бумага', confident: true },
        quantity: { value: '2 пачки', confident: true },
      },
      {
        title: { value: 'Учебный клей', confident: true },
        quantity: { value: '1 тюбик', confident: false },
      },
    ];
    const draft = {
      classification: {
        kind,
        objectId: { value: null, confident: false },
        personId: { value: null, confident: false },
        meterId: { value: null, confident: false },
        newObject: null,
        shoppingText: null,
      },
      fields,
      additional:
        kind === 'document'
          ? [
              {
                classification: {
                  kind: 'shopping',
                  objectId: { value: null, confident: false },
                  personId: { value: null, confident: false },
                  meterId: { value: null, confident: false },
                  newObject: null,
                  shoppingText: null,
                },
                fields: purchases,
              },
            ]
          : [],
    };
    await family.database.admin.query(
      "UPDATE inbox_items SET status='ready',draft=$2::jsonb WHERE id=$1",
      [id, JSON.stringify(draft)],
    );
    await openSection(page, `/more/inbox/${id}`, 'Входящее');
    if (kind === 'document') {
      await expect(page.getByText(DOCUMENT_LABELS.contract, { exact: true })).toBeVisible();
      await expect(page.getByText(/5\sокт\.\s2026/)).toBeVisible();
      await expect(page.getByText('Название: Учебная бумага', { exact: true })).toBeVisible();
      await expect(page.getByText('Название: Учебный клей', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Количество: 1 тюбик — проверьте', { exact: true }),
      ).toBeVisible();
    } else {
      await expect(page.getByText(/1\s234,56\s₽/)).toBeVisible();
      await expect(page.getByText(/25\sокт\.\s2026/)).toBeVisible();
    }
    await checkApp(page, info, `inbox-preview-${kind}`);
    if (kind === 'document') {
      await page.getByRole('button', { name: 'Сохранить как предложено', exact: true }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Входящие', exact: true }),
      ).toBeVisible();
      expect(
        (await family.database.admin.query('SELECT title FROM shopping_items ORDER BY title')).rows,
      ).toEqual([{ title: 'Учебная бумага' }, { title: 'Учебный клей' }]);
    }
  }
});
