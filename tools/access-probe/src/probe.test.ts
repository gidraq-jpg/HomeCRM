import { describe, expect, it } from 'vitest';
import {
  cleanLabel,
  escapeHtml,
  MAX_BLOB_BYTES,
  parseBlobSize,
  parseDelay,
  parseNetwork,
  parseSubscription,
} from './probe.ts';

describe('parseBlobSize', () => {
  it('принимает целые размеры от 1 байта до 8 МиБ', () => {
    expect(parseBlobSize('16384')).toBe(16384);
    expect(parseBlobSize(String(MAX_BLOB_BYTES))).toBe(MAX_BLOB_BYTES);
  });

  it('отклоняет пустое, ноль, дроби и слишком большое', () => {
    for (const raw of [null, '', '0', '1.5', '-1', '1e6', String(MAX_BLOB_BYTES + 1)]) {
      expect(parseBlobSize(raw)).toBeNull();
    }
  });
});

describe('parseDelay', () => {
  it('принимает от 0 до 15 минут целыми секундами', () => {
    expect(parseDelay(0)).toBe(0);
    expect(parseDelay(900)).toBe(900);
    expect(parseDelay(901)).toBeNull();
    expect(parseDelay(1.5)).toBeNull();
    expect(parseDelay('60')).toBeNull();
  });
});

describe('cleanLabel', () => {
  it('убирает управляющие символы и обрезает до 40 знаков', () => {
    const bell = String.fromCharCode(7);
    expect(cleanLabel(`  Телефон${bell} мамы `)).toBe('Телефон мамы');
    expect(cleanLabel('ж'.repeat(50))).toHaveLength(40);
  });

  it('подставляет «без подписи» для пустого', () => {
    expect(cleanLabel('   ')).toBe('без подписи');
    expect(cleanLabel(42)).toBe('без подписи');
  });
});

describe('parseNetwork', () => {
  it('знает только перечисленные сети', () => {
    expect(parseNetwork('mts')).toBe('mts');
    expect(parseNetwork('unknown')).toBeNull();
  });
});

describe('parseSubscription', () => {
  const valid = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    keys: { p256dh: 'BOr8J0Yp1Q-aBc_123', auth: 'aGVsbG8' },
  };

  it('принимает подписку FCM', () => {
    expect(parseSubscription(valid)).toEqual(valid);
  });

  it('отклоняет адрес без HTTPS и битые ключи', () => {
    expect(parseSubscription({ ...valid, endpoint: 'http://example.test/push' })).toBeNull();
    expect(parseSubscription({ ...valid, keys: { p256dh: 'не base64', auth: 'x' } })).toBeNull();
    expect(parseSubscription({ endpoint: valid.endpoint })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe('escapeHtml', () => {
  it('экранирует разметку', () => {
    expect(escapeHtml('<b a="1">&\'')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
  });
});
