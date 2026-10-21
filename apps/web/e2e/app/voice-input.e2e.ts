import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { TaskCard } from '../../src/tasks/api.ts';
import { expect, test } from '../auth/support/fixtures.ts';
import {
  expectAccessible,
  expectNoHorizontalScroll,
  expectTouchTargets,
  openQuick,
} from '../support/helpers.ts';
import { homeDate, setHomeZone } from './deadlines-support.ts';
import { apiAs } from './notes-support.ts';
import { seedProperty } from './property-support.ts';
import { signInAs } from './support.ts';

// D21: TASK-2 (диктовка дела) и SHOP-4 (покупки голосом). Настоящий распознаватель Chromium
// подменяется фиктивным: он выдаёт заданный текст или ошибку, звук никуда не уходит.

type Step = { text?: string; error?: string; hold?: boolean };
type VoiceWindow = Window & { __voice: Step[]; __voiceLang?: string };

async function fakeSpeech(page: Page, supported = true) {
  await page.addInitScript((supported) => {
    const target = window as unknown as VoiceWindow;
    target.__voice = [];
    type Handler<T> = ((event: T) => void) | null;
    type Result = {
      resultIndex: number;
      results: { isFinal: boolean; 0: { transcript: string } }[];
    };
    class FakeRecognition {
      lang = '';
      continuous = true;
      interimResults = false;
      maxAlternatives = 1;
      onresult: Handler<Result> = null;
      onerror: Handler<{ error: string }> = null;
      onend: (() => void) | null = null;
      step: Step = {};
      ended = false;
      emit(isFinal: boolean) {
        if (this.step.text)
          this.onresult?.({
            resultIndex: 0,
            results: [{ isFinal, 0: { transcript: this.step.text } }],
          });
      }
      finish() {
        if (this.ended) return;
        this.ended = true;
        this.onend?.();
      }
      start() {
        target.__voiceLang = this.lang;
        this.step = target.__voice.shift() ?? {};
        setTimeout(() => {
          if (this.step.error) {
            this.onerror?.({ error: this.step.error });
            this.finish();
            return;
          }
          // hold: фраза звучит, пока человек не нажмёт «Остановить запись».
          this.emit(!this.step.hold);
          if (!this.step.hold) this.finish();
        }, 50);
      }
      stop() {
        if (this.step.hold) this.emit(true);
        this.finish();
      }
      abort() {
        this.finish();
      }
    }
    const value = supported ? FakeRecognition : undefined;
    for (const name of ['SpeechRecognition', 'webkitSpeechRecognition'])
      Object.defineProperty(window, name, { value, configurable: true, writable: true });
  }, supported);
}

async function say(page: Page, ...steps: Step[]) {
  await page.evaluate((steps) => {
    (window as unknown as VoiceWindow).__voice.push(...steps);
  }, steps);
}

async function check(page: Page, info: TestInfo, name: string) {
  await expectAccessible(page, `D21-${name}`);
  await expectNoHorizontalScroll(page);
  await expectTouchTargets(page);
  if (process.platform === 'linux' && info.project.name === 'w360') {
    const directory = resolve(import.meta.dirname, '../../../../docs/screenshots/D21');
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: resolve(directory, `${name}-${info.project.name}.png`) });
  }
}

async function openShopping(page: Page) {
  await page.goto('#/more/shopping');
  await expect(page.getByLabel('Добавить одной строкой', { exact: true })).toBeVisible();
}

test('TASK-2: дело голосом — живой текст, чипы даты и объекта, сохранение', async ({
  page,
  family,
}, info) => {
  await setHomeZone(family);
  const api = await apiAs(family, 'adult');
  const property = await seedProperty(api, family, { title: 'Учебная', audience: 'household' });
  await fakeSpeech(page);
  await signInAs(page, family, 'adult');
  await openQuick(page);
  const input = page.getByLabel('Быстрая строка');
  const mic = page.getByRole('button', { name: 'Надиктовать', exact: true });
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await input.fill('#Учебная');
  await say(page, { text: 'позвонить мастеру завтра', hold: true });
  // С клавиатуры: фокус на кнопке и Enter.
  await mic.focus();
  await page.keyboard.press('Enter');
  const stop = page.getByRole('button', { name: 'Остановить запись', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.voice-status')).toContainText(
    'Идёт запись: позвонить мастеру завтра',
  );
  await expect(page.locator('.voice-announcement')).toHaveText('Идёт запись, говорите');
  expect(await page.evaluate(() => (window as unknown as VoiceWindow).__voiceLang)).toBe('ru-RU');
  await check(page, info, 'task-listening');
  await stop.click();
  // Распознанное дописано к уже введённому; ничего не сохранено само.
  await expect(input).toHaveValue('#Учебная позвонить мастеру завтра');
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.voice-announcement')).toHaveText(
    'Запись остановлена, текст добавлен',
  );
  await expect(page.locator('.task-chip')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Изменить дату:/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Изменить объект: Учебная' })).toBeVisible();
  await check(page, info, 'task-chips');
  await page.getByRole('button', { name: 'Добавить дело', exact: true }).click();
  await expect(page).toHaveURL(/tasks\/[a-f0-9-]+$/);
  const taskId = page.url().split('/').at(-1);
  const saved = TaskCard.parse((await api.get(`tasks/${taskId}`)).body);
  expect(saved).toMatchObject({ title: 'позвонить мастеру', planOn: homeDate(1) });
  const links = (await api.get(`records/task/${taskId}/links`)).body as {
    left: { id: string };
    right: { id: string };
  }[];
  expect(links.some((link) => [link.left.id, link.right.id].includes(property.id))).toBe(true);
});

test('SHOP-4: покупки голосом — черновики, правка, добавление и дубли', async ({
  page,
  family,
}, info) => {
  await fakeSpeech(page);
  await signInAs(page, family, 'adult');
  await openShopping(page);
  await say(page, { text: 'молоко, хлеб и два десятка яиц ещё сыр' });
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Надиктованные покупки', exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('listitem')).toHaveCount(4);
  await expect(sheet.getByLabel('Название позиции 3', { exact: true })).toHaveValue('Яйца');
  await expect(sheet.getByLabel('Количество позиции 3', { exact: true })).toHaveValue('20 шт.');
  await expect(sheet.getByRole('button', { name: 'Добавить 4 позиции' })).toBeVisible();
  await check(page, info, 'shopping-drafts');
  await sheet.getByRole('button', { name: 'Убрать позицию: Сыр', exact: true }).click();
  await expect(sheet.getByRole('listitem')).toHaveCount(3);
  await sheet.getByLabel('Название позиции 2', { exact: true }).fill('Хлеб бородинский');
  await sheet.getByLabel('Количество позиции 1', { exact: true }).fill('2 л');
  await check(page, info, 'shopping-drafts-edited');
  await sheet.getByRole('button', { name: 'Добавить 3 позиции' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText('Добавлены 3 позиции', { exact: true })).toBeVisible();
  for (const [title, quantity] of [
    ['Молоко', '2 л'],
    ['Хлеб бородинский', ''],
    ['Яйца', '20 шт.'],
  ] as const) {
    const row = page.locator('li.task-row', {
      has: page.getByRole('link', { name: title, exact: true }),
    });
    await expect(row).toHaveCount(1);
    if (quantity) await expect(row.locator('.shopping-quantity')).toHaveText(quantity);
  }
  await expect(page.getByRole('link', { name: 'Сыр', exact: true })).toHaveCount(0);
  await check(page, info, 'shopping-added');
  // Повтор уже купленного в списке не добавляется: та же проверка дублей, что у строки ввода.
  await say(page, { text: 'молоко и кефир' });
  await page.getByRole('button', { name: 'Надиктовать', exact: true }).click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Добавить 2 позиции' }).click();
  await expect(sheet.getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByRole('listitem')).toContainText('Уже в списке');
  await expect(
    page.getByText('Добавлена 1 позиция, уже в списке: 1', { exact: true }),
  ).toBeVisible();
  await check(page, info, 'shopping-duplicate');
  await sheet.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Кефир', exact: true })).toBeVisible();
  await expect(page.locator('li.task-row', { hasText: 'Молоко' })).toHaveCount(1);
});

test('TASK-2: отказ в микрофоне и офлайн — понятное сообщение, текст не теряется', async ({
  page,
  family,
}, info) => {
  await fakeSpeech(page);
  await signInAs(page, family, 'adult');
  await openQuick(page);
  const input = page.getByLabel('Быстрая строка');
  await input.fill('Полить вымышленные цветы');
  await say(page, { error: 'not-allowed' });
  const mic = page.getByRole('button', { name: 'Надиктовать', exact: true });
  await mic.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Нет доступа к микрофону' }),
  ).toBeVisible();
  await expect(mic).toHaveAttribute('aria-pressed', 'false');
  await expect(input).toHaveValue('Полить вымышленные цветы');
  await check(page, info, 'task-denied');
  await say(page, { error: 'no-speech' });
  await mic.click();
  await expect(page.getByRole('alert').filter({ hasText: 'Ничего не расслышали' })).toBeVisible();
  await page.context().setOffline(true);
  await mic.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Распознавание речи недоступно без интернета' }),
  ).toBeVisible();
  await expect(input).toHaveValue('Полить вымышленные цветы');
  await page.context().setOffline(false);
});

test('TASK-2, SHOP-4: браузер без распознавания речи — кнопки микрофона нет', async ({
  page,
  family,
}, info) => {
  await fakeSpeech(page, false);
  await signInAs(page, family, 'adult');
  await openQuick(page);
  await expect(page.getByLabel('Быстрая строка')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Надиктовать' })).toHaveCount(0);
  await check(page, info, 'task-unsupported');
  await page.keyboard.press('Escape');
  await openShopping(page);
  await expect(page.getByRole('button', { name: 'Надиктовать' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Добавить', exact: true })).toBeVisible();
});
