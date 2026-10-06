// Argon2id для паролей (ADR-0005, AUTH-1): формат хэша, проверка и сверка встроенной реализации
// с эталонным вектором RFC 9106.
import { argon2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARGON2_PARAMS, hashPassword, verifyPassword } from './password.ts';

const PHC = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/;

describe('Argon2id из node:crypto', () => {
  it('даёт эталонный тег из RFC 9106, раздел 5.3 (Argon2id)', () => {
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });
});

describe('hashPassword и verifyPassword', () => {
  it('хэш — строка PHC с параметрами RFC 9106 (64 МиБ, 3 прохода, 4 потока)', async () => {
    expect(ARGON2_PARAMS).toMatchObject({ memory: 65_536, passes: 3, parallelism: 4 });
    expect(await hashPassword('correct horse battery')).toMatch(PHC);
  });

  it('соль у каждого хэша своя, а пароль в хэше не виден', async () => {
    const password = 'пароль-для-проверки-123';
    const [first, second] = await Promise.all([hashPassword(password), hashPassword(password)]);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword({ hash: first, password })).toBe(true);
    expect(await verifyPassword({ hash: second, password })).toBe(true);
  });

  it('чужой пароль не подходит, регистр важен', async () => {
    const hash = await hashPassword('Secret-Passphrase-1');
    expect(await verifyPassword({ hash, password: 'Secret-Passphrase-2' })).toBe(false);
    expect(await verifyPassword({ hash, password: 'secret-passphrase-1' })).toBe(false);
    expect(await verifyPassword({ hash, password: '' })).toBe(false);
  });

  it('один пароль в разных видах Unicode — один пароль (NFKC)', async () => {
    const composed = 'ёжик-й-пароль'; // ё и й одним символом
    const decomposed = composed.normalize('NFD'); // е + диакритика, и + диакритика
    expect(decomposed).not.toBe(composed);
    const hash = await hashPassword(composed);
    expect(await verifyPassword({ hash, password: decomposed })).toBe(true);
  });

  it('параметры берутся из строки: хэш со слабыми параметрами прошлого проверяется', async () => {
    // Хэш, сделанный «раньше» с другими параметрами, тем же алгоритмом.
    const nonce = randomBytes(16);
    const key = argon2Sync('argon2id', {
      message: Buffer.from('old-password', 'utf8'),
      nonce,
      parallelism: 1,
      tagLength: 32,
      memory: 19_456,
      passes: 2,
    });
    const b64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
    const hash = `$argon2id$v=19$m=19456,t=2,p=1$${b64(nonce)}$${b64(key)}`;
    expect(await verifyPassword({ hash, password: 'old-password' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'other-password' })).toBe(false);
  });

  it('посторонняя или повреждённая строка — не совпало, а не сбой сервера', async () => {
    const good = await hashPassword('x'.repeat(12));
    const garbage = [
      '',
      'not-a-hash',
      // Формат scrypt по умолчанию в Better Auth: соль:ключ.
      `${'a'.repeat(32)}:${'b'.repeat(128)}`,
      good.replace('argon2id', 'argon2i'),
      good.replace('v=19', 'v=16'),
      good.replace('m=65536', 'm=999999999'), // слишком много памяти
      good.replace('t=3', 't=999'), // слишком много проходов
      good.replace('p=4', 'p=0'),
      `$argon2id$v=19$m=65536,t=3,p=4$AAAA$${good.split('$')[5]}`, // соль короче 8 байт
    ];
    for (const hash of garbage) {
      expect(await verifyPassword({ hash, password: 'x'.repeat(12) }), hash).toBe(false);
    }
  });
});
