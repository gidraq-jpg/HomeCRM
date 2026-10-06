// Первая настройка: создаёт дом и первого администратора (SPACE-2, сценарий S1).
//
//   node --env-file=<файл окружения сервера> deploy/scripts/first-setup.ts
//
// Нужна только DATABASE_URL_AUTH из файла окружения. Пароль спрашивается в консоли без эха и
// нигде не сохраняется: в базу он уходит хэшем Argon2id. Выполняется один раз; повторный запуск
// отказывается, пока в базе есть хоть одна учётная запись. Второй фактор администратор включает
// при первом входе: до тех пор данные и управление домом закрыты (AUTH-3).
import { createInterface } from 'node:readline/promises';
import { FirstSetupError, runFirstSetup } from '../../apps/server/src/auth/first-setup.ts';
import { createAuthDatabase, createPool } from '../../packages/db/src/index.ts';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Управляющие символы собраны из кодов: так их не искажает ни один редактор.
const CTRL_C = String.fromCodePoint(3);
const BACKSPACE = String.fromCodePoint(8);
const DELETE = String.fromCodePoint(127);

/** Строка без эха: символы не выводятся, Backspace и Ctrl+C работают. */
function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    fail('Пароль можно ввести только в интерактивной консоли.');
  }
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let value = '';
    const onData = (chunk: Buffer): void => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === CTRL_C) {
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === DELETE || char === BACKSPACE) value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

const url = process.env.DATABASE_URL_AUTH;
if (url === undefined || url === '') {
  fail('Нет DATABASE_URL_AUTH: запустите команду с --env-file=<файл окружения сервера>.');
}

const ask = createInterface({ input: process.stdin, output: process.stdout });
const householdName = (await ask.question('Название дома: ')).trim();
const displayName = (await ask.question('Ваше имя: ')).trim();
const username = (await ask.question('Логин для входа: ')).trim();
const email = (await ask.question('Адрес почты (необязательно, Enter — пропустить): ')).trim();
ask.close();

const password = await askHidden('Пароль (не короче 10 символов): ');
if (password !== (await askHidden('Пароль ещё раз: '))) fail('Пароли не совпали.');

const pool = createPool(url, {
  max: 2,
  onError: (error) => console.error(`Ошибка соединения с базой: ${error.message}`),
});
try {
  await runFirstSetup(createAuthDatabase(pool), {
    householdName,
    displayName,
    username,
    password,
    ...(email === '' ? {} : { email }),
  });
  console.log('Готово: дом и администратор созданы. Войдите и включите второй фактор.');
} catch (error) {
  if (error instanceof FirstSetupError) fail(error.message);
  throw error;
} finally {
  await pool.end();
}
