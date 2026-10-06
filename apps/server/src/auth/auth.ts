// Настройка Better Auth для HomeCRM (ADR-0005). Всё, что отличает дом от типового приложения,
// собрано здесь: вход по имени без почты, Argon2id, закрытая регистрация, сессии на 90 дней,
// второй фактор, ограничения запросов, защищённые cookie, свои имена таблиц и роль базы.
import { createHash } from 'node:crypto';
import {
  type AppDatabase,
  accounts,
  and,
  credentials,
  type Database,
  eq,
  isNull,
  passwordResets,
  rateLimits,
  sessions,
  sql,
  twoFactors,
  verifications,
} from '@homecrm/db';
import {
  type BetterAuthOptions,
  betterAuth,
  type DBAdapter,
  type DBTransactionAdapter,
  type Where,
} from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, username } from 'better-auth/plugins';
import { recordLoginEvent } from './attempts.ts';
import {
  hashToken,
  isPlaceholderEmail,
  isValidUsername,
  normalizeUsername,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX,
  USERNAME_MIN,
} from './identity.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { CLIENT_IP_HEADER, homecrm } from './plugin.ts';
import { AUTH_RATE_LIMIT } from './rate-limit.ts';

export const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60;

/** Хэш хранения, а не второй вид токена: даже значение с h1: хэшируется заново. */
export function hashSessionToken(token: string): string {
  return `h1:${createHash('sha256').update(token).digest('hex')}`;
}

function sessionModel(model: string): boolean {
  return model === 'session' || model === 'sessions';
}

function tokenData<T extends Record<string, unknown>>(model: string, data: T): T {
  return sessionModel(model) && typeof data.token === 'string'
    ? { ...data, token: hashSessionToken(data.token) }
    : data;
}

function tokenWhere(model: string, where: Where[] = []): Where[] {
  if (!sessionModel(model)) return where;
  return where.map((condition) => {
    if (condition.field !== 'token') return condition;
    if (!['eq', 'ne', 'in', 'not_in'].includes(condition.operator ?? 'eq'))
      throw new Error('Unsupported session token predicate');
    const value = condition.value;
    return {
      ...condition,
      value:
        typeof value === 'string'
          ? hashSessionToken(value)
          : Array.isArray(value)
            ? value.map((token) => {
                if (typeof token !== 'string') throw new Error('Invalid session token predicate');
                return hashSessionToken(token);
              })
            : value,
    };
  });
}

/** Открытое значение известно лишь при создании или запросе по самому токену. */
function restoreToken<T>(row: T, model: string, tokens: readonly string[]): T {
  if (!sessionModel(model) || typeof row !== 'object' || row === null || !('token' in row))
    return row;
  const token = tokens.find((candidate) => hashSessionToken(candidate) === row.token);
  return token === undefined ? row : { ...row, token };
}

function queriedTokens(where: Where[] = []): string[] {
  return where.flatMap((condition) => {
    if (condition.field !== 'token' || !['eq', 'in'].includes(condition.operator ?? 'eq'))
      return [];
    return typeof condition.value === 'string'
      ? [condition.value]
      : Array.isArray(condition.value)
        ? condition.value.filter((value): value is string => typeof value === 'string')
        : [];
  });
}

/** Обёртка внешнего контракта Drizzle: названия полей ещё те, что использует Better Auth. */
export function sessionTokenAdapter(adapter: DBTransactionAdapter): DBTransactionAdapter {
  // Сверка схемы привязана к объекту адаптера через WeakMap библиотеки: сохраняем его.
  const original = { ...adapter };
  return Object.assign(adapter, {
    ...adapter,
    create: async <T extends Record<string, unknown>, R = T>(args: {
      model: string;
      data: Omit<T, 'id'>;
      select?: string[];
      forceAllowId?: boolean;
    }): Promise<R> => {
      const row = await original.create<T, R>({ ...args, data: tokenData(args.model, args.data) });
      return restoreToken(
        row,
        args.model,
        typeof args.data.token === 'string' ? [args.data.token] : [],
      );
    },
    findOne: async <T>(args: Parameters<DBAdapter['findOne']>[0]) =>
      restoreToken(
        await original.findOne<T>({ ...args, where: tokenWhere(args.model, args.where) }),
        args.model,
        queriedTokens(args.where),
      ),
    findMany: async <T>(args: Parameters<DBAdapter['findMany']>[0]) => {
      const rows = await original.findMany<T>({
        ...args,
        where: tokenWhere(args.model, args.where),
      });
      return rows.map((row) => restoreToken(row, args.model, queriedTokens(args.where)));
    },
    update: async <T>(args: Parameters<DBAdapter['update']>[0]) =>
      restoreToken(
        await original.update<T>({
          ...args,
          where: tokenWhere(args.model, args.where),
          update: tokenData(args.model, args.update),
        }),
        args.model,
        typeof args.update.token === 'string' ? [args.update.token] : queriedTokens(args.where),
      ),
    updateMany: (args) =>
      original.updateMany({
        ...args,
        where: tokenWhere(args.model, args.where),
        update: tokenData(args.model, args.update),
      }),
    delete: (args) => original.delete({ ...args, where: tokenWhere(args.model, args.where) }),
    deleteMany: (args) =>
      original.deleteMany({ ...args, where: tokenWhere(args.model, args.where) }),
    count: (args) => original.count({ ...args, where: tokenWhere(args.model, args.where) }),
    consumeOne: async <T>(args: Parameters<DBAdapter['consumeOne']>[0]) =>
      restoreToken(
        await original.consumeOne<T>({ ...args, where: tokenWhere(args.model, args.where) }),
        args.model,
        queriedTokens(args.where),
      ),
    incrementOne: async <T>(args: Parameters<DBAdapter['incrementOne']>[0]) =>
      restoreToken(
        await original.incrementOne<T>({
          ...args,
          where: tokenWhere(args.model, args.where),
          ...(args.set ? { set: tokenData(args.model, args.set) } : {}),
        }),
        args.model,
        typeof args.set?.token === 'string' ? [args.set.token] : queriedTokens(args.where),
      ),
  } satisfies DBTransactionAdapter);
}

/** Отправка писем. Если не задана — восстановление по почте выключено (AUTH-4). */
export type Mailer = (message: { to: string; subject: string; text: string }) => Promise<void>;

export interface AuthOptions {
  /** База службы входа: роль homecrm_auth. */
  db: Database;
  /** База приложения: роль homecrm_app. Нужна маршрутам, которые работают от имени участника. */
  appDb: AppDatabase;
  /** Секрет Better Auth: шифрует секреты второго фактора и подписывает cookie. Из файла окружения, не из кода. */
  secret: string;
  /** Происхождение приложения, как его видит браузер: https://home.example. */
  baseURL: string;
  /** Откуда принимаются запросы с cookie помимо baseURL (например, адрес Vite в разработке). */
  trustedOrigins?: readonly string[];
  /** Часовой пояс дома (IANA): отдаётся клиенту в /api/me. По умолчанию — Asia/Yekaterinburg. */
  homeTimeZone?: string;
  mailer?: Mailer;
  /** Куда писать сообщения библиотеки. По умолчанию — только ошибки, в консоль. */
  logger?: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: unknown[]) => void;
  };
}

export function createAuth(options: AuthOptions) {
  const { db, baseURL } = options;
  const origin = new URL(baseURL).origin;

  return betterAuth({
    appName: 'HomeCRM',
    baseURL: origin,
    secret: options.secret,
    telemetry: { enabled: false },
    logger: { level: 'error', disableColors: true, ...options.logger },
    trustedOrigins: [origin, ...(options.trustedOrigins ?? [])],

    // Таблицы — наши, в схеме packages/db. Имена моделей совпадают с именами экспортов схемы:
    // так их находит адаптер. Идентификаторы выдаёт база (uuidv7), а не библиотека.
    database: (authOptions: BetterAuthOptions) => {
      const adapter = drizzleAdapter(db, {
        provider: 'pg',
        transaction: true,
        schema: { accounts, sessions, credentials, verifications, twoFactors, rateLimits },
      })(authOptions);
      const transaction = adapter.transaction.bind(adapter);
      return Object.assign(adapter, sessionTokenAdapter(adapter), {
        // Внутри транзакции библиотека выбирает отдельный адаптер; его тоже оборачиваем.
        transaction: <R>(callback: (tx: DBTransactionAdapter) => Promise<R>) =>
          transaction((tx) => callback(sessionTokenAdapter(tx))),
      });
    },
    user: { modelName: 'accounts', fields: { name: 'displayName' } },
    session: {
      modelName: 'sessions',
      // До 90 дней и продление при использовании: срок сдвигается не чаще раза в сутки (AUTH-6).
      expiresIn: SESSION_DAYS * DAY,
      updateAge: DAY,
      // Свежесть сессии не требуем: «повторный ввод пароля» мы делаем сами и точнее (AUTH-7), а
      // с проверкой свежести «список устройств» не открылся бы на телефоне с сессией старше суток.
      freshAge: 0,
    },
    account: { modelName: 'credentials' },
    verification: {
      modelName: 'verifications',
      // Ссылка сброса пароля — это токен в адресе: в базе только его хэш (SHA-256), как у приглашений.
      // Префикс остаётся открытым: так выдача новой ссылки находит и отзывает прежние (plugin.ts).
      storeIdentifier: {
        default: 'plain',
        overrides: {
          'reset-password:': {
            hash: async (identifier) => `reset-password:${hashToken(identifier)}`,
          },
        },
      },
    },
    advanced: {
      database: { generateId: false },
      cookiePrefix: 'homecrm',
      // Secure, HttpOnly и SameSite — всегда, а не «в боевом окружении» (PRD, раздел 13).
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      // Защита от CSRF: проверка Origin на каждом запросе с cookie и заголовки Fetch Metadata.
      // По умолчанию в тестовой среде она выключена; здесь включена явно.
      disableCSRFCheck: false,
      disableOriginCheck: false,
      // Адрес клиента библиотека берёт только из заголовка, который ставит наш Fastify.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    emailAndPassword: {
      enabled: true,
      // Открытой регистрации нет: в дом приглашают (AUTH-2), учётную запись создаёт плагин homecrm.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      // Восстановление по почте — только если на сервере настроена почта (AUTH-4).
      ...(options.mailer
        ? {
            sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
              // Ребёнку без почты писать некуда: служебный адрес никуда не ведёт.
              if (isPlaceholderEmail(user.email)) return;
              await options.mailer?.({
                to: user.email,
                subject: 'HomeCRM: сброс пароля',
                text: `Чтобы задать новый пароль, откройте ссылку: ${url}`,
              });
            },
          }
        : {}),
      onPasswordReset: async ({ user }, request) => {
        // Ребёнок задал новый пароль по ссылке администратора: сброс выполнен, отметка появится
        // при следующем входе (AUTH-5), а в журнале входов — запись о смене пароля.
        await db
          .update(passwordResets)
          .set({ completedAt: sql`now()` })
          .where(and(eq(passwordResets.accountId, user.id), isNull(passwordResets.completedAt)));
        await recordLoginEvent(db, {
          accountId: user.id,
          kind: 'password_reset',
          outcome: 'success',
          ipAddress: request?.headers.get(CLIENT_IP_HEADER) ?? null,
          userAgent: request?.headers.get('user-agent') ?? null,
        });
      },
    },

    // Ограничение запросов по адресу и пути (AUTH-8), счётчики — в базе, чтобы переживать перезапуск.
    // Окно сдвигается с последним запросом: после лимита ждать надо окно целиком.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimits',
      ...AUTH_RATE_LIMIT,
      customRules: {
        '/sign-in/username': { window: 900, max: 20 },
        '/sign-in/email': { window: 900, max: 20 },
        '/reset-password': { window: 900, max: 10 },
      },
    },

    // Лишние маршруты закрыты: внешних поставщиков входа, подтверждения почты, смены почты и
    // самоудаления нет, а проверка «свободно ли имя» открыла бы перебор имён без входа.
    disabledPaths: [
      // Список без токенов и отзыв по id обслуживает Fastify (routes.ts).
      '/list-sessions',
      '/revoke-session',
      '/revoke-other-sessions',
      '/sign-in/social',
      '/link-social',
      '/unlink-account',
      '/callback/:id',
      '/get-access-token',
      '/refresh-token',
      '/list-accounts',
      '/account-info',
      '/verify-email',
      '/send-verification-email',
      '/change-email',
      '/delete-user',
      '/delete-user/callback',
      '/update-session',
      '/is-username-available',
      '/two-factor/send-otp',
      '/two-factor/verify-otp',
      '/error',
      // scope: "server" в библиотеке не закрывает маршрут по HTTP: через него пароль подбирался без
      // блокировки. Изнутри auth.api.verifyPassword (confirmPassword) по-прежнему работает.
      '/verify-password',
    ],

    plugins: [
      username({
        minUsernameLength: USERNAME_MIN,
        maxUsernameLength: USERNAME_MAX,
        usernameNormalization: normalizeUsername,
        usernameValidator: isValidUsername,
      }),
      twoFactor({
        issuer: 'HomeCRM',
        twoFactorTable: 'twoFactors',
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
      }),
      homecrm({ db, baseURL: origin }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
