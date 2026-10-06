// Одноразовые коды TOTP по RFC 6238 — отдельная от библиотеки реализация для тестов: так
// проверяется, что приложение-аутентификатор с её URI получит те же коды, что ждёт сервер.
import { createHmac } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 по RFC 4648 без дополнения: так секрет лежит в ссылке otpauth://. */
export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`Not a base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Код TOTP для секрета (сырые байты) на момент времени: HMAC-SHA1, шаг 30 с, 6 цифр по умолчанию. */
export function totpCode(
  secret: Buffer,
  atMs: number = Date.now(),
  { digits = 6, period = 30, algorithm = 'sha1' } = {},
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / period)));
  const hmac = createHmac(algorithm, secret).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    ((hmac[offset + 1] ?? 0) << 16) |
    ((hmac[offset + 2] ?? 0) << 8) |
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Секрет и параметры из ссылки otpauth://totp/...?secret=...&digits=6&period=30. */
export function parseOtpauth(uri: string): { secret: Buffer; digits: number; period: number } {
  const url = new URL(uri);
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') {
    throw new Error(`Not a TOTP URI: ${url.protocol}//${url.hostname}`);
  }
  const secret = url.searchParams.get('secret');
  if (secret === null) throw new Error('No secret in the TOTP URI');
  return {
    secret: base32Decode(secret),
    digits: Number(url.searchParams.get('digits') ?? 6),
    period: Number(url.searchParams.get('period') ?? 30),
  };
}

/** Код для ссылки otpauth:// на текущий момент — как это сделало бы приложение на телефоне. */
export function currentCode(uri: string, atMs: number = Date.now()): string {
  const { secret, digits, period } = parseOtpauth(uri);
  return totpCode(secret, atMs, { digits, period });
}
