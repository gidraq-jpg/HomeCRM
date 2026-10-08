import { describe, expect, it } from 'vitest';
import { deviceName, UNKNOWN_DEVICE } from './device-name.ts';
import { keyToBytes, sameKey } from './push-key.ts';
import {
  describePush,
  FALLBACK_TEXT,
  OPEN_MESSAGE,
  parsePushData,
  routeFromMessage,
  safeRoute,
  targetRoute,
} from './push-message.ts';

const RECORD = '6f1c2a40-7d2e-4a52-9a7b-0d3c5e8f1a22';

describe('название устройства', () => {
  it('телефон и компьютер: система и браузер', () => {
    expect(
      deviceName(
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Chrome');
    expect(
      deviceName(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ),
    ).toBe('Windows · Edge');
    expect(
      deviceName(
        'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Android · Samsung Internet');
    expect(
      deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'),
    ).toBe('Linux · Firefox');
  });

  it('безголовый Chrome из тестов тоже узнаётся, неизвестное не ломает строку', () => {
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0) HeadlessChrome/130.0.0.0 Safari/537.36')).toBe(
      'Windows · Chrome',
    );
    expect(deviceName('')).toBe(UNKNOWN_DEVICE);
    expect(deviceName('curl/8.0')).toBe(UNKNOWN_DEVICE);
  });
});

describe('содержимое push', () => {
  it('сервер присылает вид, запись и текст: тег по записи, заголовок — название приложения', () => {
    expect(
      describePush({ kind: 'deadline', recordId: RECORD, text: 'В HomeCRM есть новое' }),
    ).toEqual({
      title: 'HomeCRM',
      body: 'В HomeCRM есть новое',
      tag: `deadline-${RECORD}`,
      recordId: RECORD,
    });
  });

  it('заголовок и текст берутся из содержимого, лишние пробелы и длина ограничены', () => {
    const result = describePush({ title: '  Срок  подходит ', body: 'x'.repeat(500) });
    expect(result.title).toBe('Срок подходит');
    expect(result.body).toHaveLength(300);
    expect(result.recordId).toBeNull();
    expect(result.tag).toBe('news');
  });

  it('пустое, чужой формы и повреждённое содержимое даёт запасной текст', () => {
    for (const raw of [null, undefined, 42, [], {}, { text: 7 }, { text: '   ' }]) {
      const result = describePush(raw);
      expect(result.title).toBe('HomeCRM');
      expect(result.body).toBe(FALLBACK_TEXT);
    }
  });

  it('простой текст показывается как текст', () => {
    expect(describePush('Проверьте приложение').body).toBe('Проверьте приложение');
  });

  it('идентификатор записи — только UUID: из него складываются тег и адрес', () => {
    expect(describePush({ recordId: '../../admin', kind: 'deadline' })).toMatchObject({
      recordId: null,
      tag: 'deadline',
    });
    expect(describePush({ recordId: RECORD.toUpperCase(), kind: 'bad kind!' })).toMatchObject({
      recordId: RECORD,
      tag: `badkind-${RECORD}`,
    });
  });

  it('данные push: JSON, простой текст или ничего', () => {
    expect(parsePushData({ json: () => ({ a: 1 }), text: () => '' })).toEqual({ a: 1 });
    expect(
      parsePushData({
        json: () => {
          throw new SyntaxError('not json');
        },
        text: () => 'просто текст',
      }),
    ).toBe('просто текст');
    expect(parsePushData(null)).toBeNull();
  });
});

describe('куда ведёт нажатие', () => {
  it('на запись, а без записи — в радар', () => {
    expect(targetRoute(RECORD)).toBe(`/open/${RECORD}`);
    expect(targetRoute(null)).toBe('/more/radar');
  });

  it('страница переходит только по известным маршрутам', () => {
    expect(safeRoute(`/open/${RECORD}`)).toBe(`/open/${RECORD}`);
    expect(safeRoute('/more/radar')).toBe('/more/radar');
    for (const bad of [
      '/sign-in',
      '/open/abc',
      `/open/${RECORD}/x`,
      'https://evil.example',
      7,
      null,
    ])
      expect(safeRoute(bad)).toBeNull();
  });

  it('сообщение воркера: маршрут берётся только из своего сообщения с известным маршрутом', () => {
    expect(routeFromMessage({ type: OPEN_MESSAGE, route: `/open/${RECORD}` })).toBe(
      `/open/${RECORD}`,
    );
    expect(routeFromMessage({ type: OPEN_MESSAGE, route: '/sign-in' })).toBeNull();
    expect(routeFromMessage({ type: 'other', route: '/more/radar' })).toBeNull();
    expect(routeFromMessage({ route: '/more/radar' })).toBeNull();
    expect(routeFromMessage(null)).toBeNull();
    expect(routeFromMessage('/more/radar')).toBeNull();
  });
});

describe('ключ VAPID', () => {
  it('base64url превращается в те же байты', () => {
    const bytes = keyToBytes('AAECA_--');
    expect([...bytes]).toEqual([0, 1, 2, 3, 255, 190]);
    expect(sameKey(bytes.buffer, bytes)).toBe(true);
    expect(sameKey(new Uint8Array([1, 2]).buffer, bytes)).toBe(false);
    expect(sameKey(null, bytes)).toBe(true);
  });
});
