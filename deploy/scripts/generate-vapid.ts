// Создаёт ключи VAPID для push (ADR-0009) в файле окружения.
// Существующий файл не перезаписывается: потеря ключей обнуляет все подписки.
// Ключи на экран не выводятся.
// Запуск: node deploy/scripts/generate-vapid.ts <файл> <mailto:адрес или https://адрес>
//
// Пара — ключ P-256 в том же виде, что у web-push: открытый — несжатая точка (65 байт),
// закрытый — 32 байта, оба в base64url. Только node:crypto, чтобы скрипту не нужны были
// зависимости пакетов (до D53e он лежал в tools/access-probe).
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const [file, subject] = process.argv.slice(2);
if (file === undefined || subject === undefined) {
  console.error('Использование: node generate-vapid.ts <файл> <mailto:… или https://…>');
  process.exit(2);
}
if (existsSync(file)) {
  console.log('Ключи VAPID уже есть — оставляю как есть.');
  process.exit(0);
}

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' });
if (!jwk.x || !jwk.y || !jwk.d) throw new Error('VAPID key export failed');
const publicKey = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(jwk.x, 'base64url'),
  Buffer.from(jwk.y, 'base64url'),
]).toString('base64url');

writeFileSync(
  file,
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\nVAPID_SUBJECT=${subject}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' },
);
console.log(`Ключи VAPID созданы: ${file}`);
