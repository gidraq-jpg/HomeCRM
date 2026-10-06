// Тестовая реализация TOTP сверена с эталонными примерами RFC 6238 (приложение B): на ней
// держатся все тесты второго фактора, поэтому сама она должна быть верной.
import { describe, expect, it } from 'vitest';
import { base32Decode, parseOtpauth, totpCode } from './totp.ts';

const SECRET_SHA1 = Buffer.from('12345678901234567890');
const SECRET_SHA256 = Buffer.from('12345678901234567890123456789012');

describe('totpCode по RFC 6238', () => {
  // Время в секундах → ожидаемый код из 8 цифр (приложение B).
  const SHA1: Array<[number, string]> = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
  ];

  it('SHA-1', () => {
    for (const [seconds, code] of SHA1) {
      expect(totpCode(SECRET_SHA1, seconds * 1000, { digits: 8 }), String(seconds)).toBe(code);
    }
  });

  it('SHA-256', () => {
    expect(totpCode(SECRET_SHA256, 59_000, { digits: 8, algorithm: 'sha256' })).toBe('46119246');
  });

  it('шесть цифр — последние шесть из восьми, ведущие нули сохраняются', () => {
    expect(totpCode(SECRET_SHA1, 1_111_111_109 * 1000, { digits: 6 })).toBe('081804');
  });
});

describe('base32 и ссылка otpauth://', () => {
  it('base32 по RFC 4648', () => {
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('GEZDGNBVGY3TQOJQ').toString()).toBe('1234567890');
  });

  it('читает секрет и параметры из ссылки', () => {
    const parsed = parseOtpauth(
      'otpauth://totp/HomeCRM:anna?secret=GEZDGNBVGY3TQOJQ&issuer=HomeCRM&digits=6&period=30',
    );
    expect(parsed.secret.toString()).toBe('1234567890');
    expect(parsed).toMatchObject({ digits: 6, period: 30 });
  });
});
