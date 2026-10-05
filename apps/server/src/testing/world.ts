// Мир для тестов входа: своя база со всеми миграциями и ролями, приложение Fastify с настоящей
// Better Auth и вымышленная семья. Секреты (ключ библиотеки, пароли) создаются во время
// прогона и нигде не сохраняются.
import { randomBytes } from 'node:crypto';
import { createAppDatabase, createAuthDatabase } from '@homecrm/db';
import { createTestDatabase, type TestDatabase } from '@homecrm/db/testing';
import type { Role } from '@homecrm/shared';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../app.ts';
import type { Mailer } from '../auth/auth.ts';
import { createHousehold, provisionAccount } from '../auth/provision.ts';
import { type AuthModule, createAuthModule } from '../auth/routes.ts';
import { BASE_URL, Device } from './device.ts';

export interface Person {
  key: 'anna' | 'boris' | 'vera';
  id: string;
  username: string;
  displayName: string;
  password: string;
  role: Role;
  personalSpaceId: string;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface World {
  database: TestDatabase;
  module: AuthModule;
  app: FastifyInstance;
  houseId: string;
  anna: Person;
  boris: Person;
  vera: Person;
  /** Сообщения библиотеки: на уровне debug, чтобы проверить, что в них нет секретов. */
  logs: string[];
  /** Журнал запросов Fastify (pino): строки JSON, как они ушли бы на стандартный вывод. */
  requestLog: string[];
  /** Письма, которые «отправил» сервер. */
  mailbox: Mail[];
  /** Секрет Better Auth этого прогона — для проверки, что он нигде не всплывает. */
  secret: string;
  device(options?: { userAgent?: string; ip?: string }): Device;
  /** Сбросить счётчики ограничения запросов по адресу: время в тестах не ждём, а переводим. */
  clearRateLimits(): Promise<void>;
  close(): Promise<void>;
}

export interface WorldOptions {
  /** Почта настроена: восстановление по e-mail работает (AUTH-4). */
  mail?: boolean;
  /** Не создавать вымышленную семью: пустой дом без участников. */
  empty?: boolean;
}

/** Пароли — вымышленные и разные, чтобы по журналам было видно, чей пароль где всплыл. */
const FAMILY: ReadonlyArray<Omit<Person, 'id' | 'personalSpaceId'>> = [
  {
    key: 'anna',
    username: 'anna',
    displayName: 'Анна',
    password: 'anna-pass-4711-ok',
    role: 'admin',
  },
  {
    key: 'boris',
    username: 'boris',
    displayName: 'Борис',
    password: 'boris-pass-5822-ok',
    role: 'adult',
  },
  {
    key: 'vera',
    username: 'vera',
    displayName: 'Вера',
    password: 'vera-pass-6933-ok',
    role: 'child',
  },
];

export async function createWorld(options: WorldOptions = {}): Promise<World> {
  const database = await createTestDatabase(inject('pgAdminUrl'));
  const secret = randomBytes(32).toString('base64url');
  const logs: string[] = [];
  const requestLog: string[] = [];
  const mailbox: Mail[] = [];
  const mailer: Mailer = async (message) => {
    mailbox.push(message);
  };
  const module = createAuthModule({
    db: createAuthDatabase(database.auth),
    appDb: createAppDatabase(database.app),
    secret,
    baseURL: BASE_URL,
    logger: {
      level: 'debug',
      log: (level, message, ...args) => {
        logs.push(`${level} ${message} ${args.map((arg) => safeString(arg)).join(' ')}`);
      },
    },
    ...(options.mail ? { mailer } : {}),
  });
  const app = buildApp(
    { LOG_LEVEL: 'info', APP_VERSION: 'test' },
    { auth: module, logStream: { write: (line) => void requestLog.push(line) } },
  );
  await app.ready();

  const houseId = await createHousehold(module.db, 'Дом');
  const people: Person[] = [];
  if (!options.empty) {
    for (const person of FAMILY) {
      const created = await provisionAccount(module.db, {
        username: person.username,
        displayName: person.displayName,
        password: person.password,
        householdId: houseId,
        role: person.role,
        // У взрослых — настоящая почта (она нужна для входа по e-mail и сброса); у ребёнка её нет.
        ...(person.role === 'child' ? {} : { email: `${person.username}@family.test` }),
      });
      people.push({ ...person, id: created.id, personalSpaceId: created.personalSpaceId });
    }
  }
  const byKey = (key: Person['key']): Person => {
    const found = people.find((person) => person.key === key);
    if (found === undefined) throw new Error(`The world has no ${key}`);
    return found;
  };

  return {
    database,
    module,
    app,
    houseId,
    get anna() {
      return byKey('anna');
    },
    get boris() {
      return byKey('boris');
    },
    get vera() {
      return byKey('vera');
    },
    logs,
    requestLog,
    mailbox,
    secret,
    device: (deviceOptions) => new Device(app, deviceOptions),
    async clearRateLimits() {
      await database.admin.query('DELETE FROM rate_limits');
    },
    async close() {
      await app.close();
      await database.drop();
    },
  };
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, (_key, item) =>
      item instanceof Error ? { name: item.name, message: item.message } : item,
    );
  } catch {
    return String(value);
  }
}
