import type { Page } from '@playwright/test';
import type { Family } from '../auth/support/family.ts';
import type { Api } from './notes-support.ts';
import { expect } from './support.ts';

/** Телефон Android с Chrome: по нему сценарии проверяют название устройства «Android · Chrome». */
export const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export interface FakePush {
  /** Разрешение браузера до первого вопроса. */
  permission?: 'default' | 'granted' | 'denied';
  /** Что ответит человек на вопрос о разрешении. */
  answer?: 'granted' | 'denied';
  /** Браузер без push: нет `PushManager`. */
  supported?: boolean;
  /** Служба push не отвечает: `subscribe` завершается ошибкой. */
  subscribeFails?: boolean;
}

/**
 * Подмена `PushManager` и разрешения: настоящая подписка в тестовом Chromium невозможна (нужна служба
 * FCM), а экраны должны работать с любым ответом браузера. Состояние лежит в sessionStorage вкладки и
 * переживает перезагрузку, как настоящая подписка. Адрес — из списка, который принимает сервер.
 */
export async function installFakePush(page: Page, options: FakePush = {}) {
  await page.addInitScript(
    (init) => {
      if (init.supported === false) {
        Reflect.deleteProperty(window, 'PushManager');
        return;
      }
      const KEY = '__fake_push';
      interface State {
        permission: string;
        sub: string | null;
        key: number[] | null;
      }
      const read = (): State =>
        JSON.parse(sessionStorage.getItem(KEY) ?? 'null') ?? {
          permission: init.permission ?? 'default',
          sub: null,
          key: null,
        };
      const write = (state: State) => sessionStorage.setItem(KEY, JSON.stringify(state));
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => read().permission,
      });
      Notification.requestPermission = async () => {
        const state = read();
        if (state.permission === 'default') {
          state.permission = init.answer ?? 'denied';
          write(state);
        }
        return state.permission as NotificationPermission;
      };
      const make = (state: State) => {
        const endpoint = `https://fcm.googleapis.com/fcm/send/fake-${state.sub}`;
        return {
          endpoint,
          options: { applicationServerKey: new Uint8Array(state.key ?? []).buffer },
          toJSON: () => ({
            endpoint,
            keys: { p256dh: `BA${'A'.repeat(85)}`, auth: 'A'.repeat(22) },
          }),
          unsubscribe: async () => {
            write({ ...read(), sub: null, key: null });
            return true;
          },
        };
      };
      PushManager.prototype.getSubscription = async () => {
        const state = read();
        return state.sub ? (make(state) as unknown as PushSubscription) : null;
      };
      PushManager.prototype.subscribe = async (subscribeOptions) => {
        if (init.subscribeFails) throw new DOMException('Push service error', 'AbortError');
        const state = read();
        state.sub = crypto.randomUUID();
        state.key = [...new Uint8Array(subscribeOptions?.applicationServerKey as ArrayBuffer)];
        write(state);
        return make(state) as unknown as PushSubscription;
      };
    },
    {
      permission: options.permission,
      answer: options.answer,
      supported: options.supported,
      subscribeFails: options.subscribeFails,
    },
  );
}

/** Ключ, с которым страница подписала браузер (base64url), и признак подписки. */
export async function fakeSubscription(page: Page): Promise<{ subscribed: boolean; key: string }> {
  return page.evaluate(() => {
    const state = JSON.parse(sessionStorage.getItem('__fake_push') ?? 'null');
    const bytes: number[] = state?.key ?? [];
    const key = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    return { subscribed: Boolean(state?.sub), key };
  });
}

/** Подписка участника через API: так в списке появляется устройство, которого нет в браузере теста. */
export async function seedDevice(api: Api, name: string, tag: string): Promise<string> {
  const created = await api.post('push/subscriptions', {
    endpoint: `https://fcm.googleapis.com/fcm/send/seed-${tag}`,
    keys: { p256dh: `BA${'B'.repeat(85)}`, auth: 'B'.repeat(22) },
    deviceName: name,
  });
  if (created.status !== 201) throw new Error(`Test device was not created: ${created.status}`);
  return (created.body as { id: string }).id;
}

/** Попытка отправки в журнале: так экран видит итоги, которых тестовый сервер не создаёт. */
export async function seedAttempt(
  family: Family,
  accountId: string,
  deviceId: string,
  attempt: { result: string; errorCode?: number; minutesAgo: number },
) {
  await family.database.admin.query(
    `INSERT INTO push_attempts(account_id, device_id, kind, attempted_at, result, error_code)
     VALUES ($1, $2, 'deadline', now() - make_interval(mins => $3), $4, $5)`,
    [accountId, deviceId, attempt.minutesAgo, attempt.result, attempt.errorCode ?? null],
  );
}

export async function openNotifications(page: Page) {
  await page.goto('#/more');
  await page.getByRole('link', { name: /^Уведомления/ }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Уведомления', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Загружаем устройства…')).toHaveCount(0);
  await expect(page.getByText('Загружаем настройки…')).toHaveCount(0);
}

/** Блок экрана по заголовку второго уровня. */
export const block = (page: Page, title: string) =>
  page.locator('section.section').filter({
    has: page.getByRole('heading', { level: 2, name: title, exact: true }),
  });

export const thisDevice = (page: Page) => block(page, 'Это устройство');

export const devicesList = (page: Page) => page.getByRole('list', { name: 'Мои устройства' });
