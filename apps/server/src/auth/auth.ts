// Настройка Better Auth для HomeCRM (ADR-0005). Всё, что отличает дом от типового приложения,
// собрано здесь: вход по имени без почты, Argon2id, закрытая регистрация, сессии на 90 дней,
// второй фактор, ограничения запросов, защищённые cookie, свои имена таблиц и роль базы.
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
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { twoFactor, username } from 'better-auth/plugins';
import { recordLoginEvent } from './attempts.ts';
import {
  isPlaceholderEmail,
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX,
  USERNAME_MIN,
} from './identity.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { CLIENT_IP_HEADER, homecrm } from './plugin.ts';

export const SESSION_DAYS = 90;
const DAY = 24 * 60 * 60;

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
    database: drizzleAdapter(db, {
      provider: 'pg',
      transaction: true,
      schema: { accounts, sessions, credentials, verifications, twoFactors, rateLimits },
    }),
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
    verification: { modelName: 'verifications' },
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
      minPasswordLength: 10,
      maxPasswordLength: 128,
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
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/username': { window: 900, max: 20 },
        '/sign-in/email': { window: 900, max: 20 },
        '/reset-password': { window: 900, max: 10 },
      },
    },

    // Лишние маршруты закрыты: внешних поставщиков входа, подтверждения почты, смены почты и
    // самоудаления нет, а проверка «свободно ли имя» открыла бы перебор имён без входа.
    disabledPaths: [
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
