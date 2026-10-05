// Создаёт ключи VAPID для push (ADR-0009) в файле окружения.
// Существующий файл не перезаписывается: потеря ключей обнуляет все подписки.
// Ключи на экран не выводятся.
// Запуск: node scripts/generate-vapid.ts <файл> <mailto:адрес или https://адрес>
import { existsSync, writeFileSync } from 'node:fs';
import webpush from 'web-push';

const [file, subject] = process.argv.slice(2);
if (file === undefined || subject === undefined) {
  console.error('Использование: node scripts/generate-vapid.ts <файл> <mailto:… или https://…>');
  process.exit(2);
}
if (existsSync(file)) {
  console.log('Ключи VAPID уже есть — оставляю как есть.');
  process.exit(0);
}

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
writeFileSync(
  file,
  `VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\nVAPID_SUBJECT=${subject}\n`,
  { encoding: 'utf8', mode: 0o600, flag: 'wx' },
);
console.log(`Ключи VAPID созданы: ${file}`);
