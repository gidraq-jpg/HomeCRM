// Хэш паролей Argon2id (AUTH-1). Better Auth по умолчанию хранит пароли через scrypt, поэтому
// своя функция хэширования подключается в emailAndPassword.password (auth.ts).
//
// Реализация — встроенный node:crypto (OpenSSL 3.5, Node 24.7+): ни новой зависимости, ни сборки
// при установке. Сверена с эталонным вектором RFC 9106 (password.test.ts). Строка хэша — формат PHC:
// $argon2id$v=19$m=65536,t=3,p=4$<соль>$<хэш>; параметры лежат в самой строке, поэтому их можно
// усилить позже, и старые хэши продолжат проверяться.
import { type Argon2Parameters, argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/** Второй вариант из RFC 9106 (раздел 4): 64 МиБ памяти, 3 прохода, 4 потока; на этом компьютере ≈90 мс. */
export const ARGON2_PARAMS = {
  memory: 65_536,
  passes: 3,
  parallelism: 4,
  tagLength: 32,
  saltLength: 16,
} as const;

// Границы для хэша из базы: чужая строка не должна заставить сервер занять гигабайты или часы.
const LIMITS = { memory: 1_048_576, passes: 16, parallelism: 16, tagLength: 64 } as const;

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Пароль приводится к виду NFKC: один и тот же пароль с разных клавиатур даёт один хэш (NIST SP 800-63B). */
function passwordBytes(password: string): Buffer {
  return Buffer.from(password.normalize('NFKC'), 'utf8');
}

function derive(parameters: Argon2Parameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', parameters, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

const encode = (bytes: Buffer): string => bytes.toString('base64').replace(/=+$/, '');

export async function hashPassword(password: string): Promise<string> {
  const { memory, passes, parallelism, tagLength, saltLength } = ARGON2_PARAMS;
  const nonce = randomBytes(saltLength);
  const key = await derive({
    message: passwordBytes(password),
    nonce,
    memory,
    passes,
    parallelism,
    tagLength,
  });
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${encode(nonce)}$${encode(key)}`;
}

/** Проверка пароля по строке PHC. Любая неразборчивая строка — просто «не совпало», а не ошибка. */
export async function verifyPassword({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const match = PHC.exec(hash);
  if (match === null) return false;
  const [, m, t, p, saltText, tagText] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const nonce = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(tagText, 'base64');
  const parameters = { memory: Number(m), passes: Number(t), parallelism: Number(p) };
  if (
    parameters.parallelism < 1 ||
    parameters.parallelism > LIMITS.parallelism ||
    parameters.passes < 1 ||
    parameters.passes > LIMITS.passes ||
    parameters.memory < 8 * parameters.parallelism ||
    parameters.memory > LIMITS.memory ||
    nonce.length < 8 ||
    expected.length < 4 ||
    expected.length > LIMITS.tagLength
  ) {
    return false;
  }
  const actual = await derive({
    message: passwordBytes(password),
    nonce,
    ...parameters,
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
