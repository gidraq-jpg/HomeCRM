// Настройки сервера из переменных окружения. Секреты сюда попадут из файла в E:\HomeCRM-data\secrets.
import { z } from 'zod';

/**
 * Каким прокси верить, читая адрес клиента из X-Forwarded-For (параметр trustProxy Fastify).
 * - `false` — никаким: адрес клиента — тот, с которого пришло соединение;
 * - `true` — любому: только если сервер слушает закрытую сеть, куда ходит один туннель;
 * - иначе список адресов, подсетей или имён loopback, linklocal, uniquelocal через запятую:
 *   верим только прокси из списка.
 * За туннелем без этого у всех запросов один адрес, и ограничение попыток по адресу (AUTH-8)
 * стало бы общим на всю семью.
 */
export type TrustProxy = boolean | string[];

const PROXY_ENTRY = /^[A-Za-z0-9.:/_-]+$/;

function parseTrustProxy(value: string, context: z.RefinementCtx): TrustProxy {
  const text = value.trim().toLowerCase();
  if (text === 'false' || text === '') return false;
  if (text === 'true') return true;
  const entries = text.split(',').map((entry) => entry.trim());
  if (entries.every((entry) => PROXY_ENTRY.test(entry) && !/^\d+$/.test(entry))) return entries;
  context.addIssue({
    code: 'custom',
    message: 'TRUST_PROXY: false, true or a comma-separated list of addresses',
  });
  return z.NEVER;
}

const EnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  // 8310 — разработка; в рабочем окружении 8300, в предпросмотре 8301 (план, раздел 2.2).
  PORT: z.coerce.number().int().min(1).max(65535).default(8310),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
  TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}

const PostgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')
  .refine((value) => URL.canParse(value), 'must be a valid URL');

const HttpOrigin = z
  .string()
  .refine((value) => URL.canParse(value) && /^https?:$/.test(new URL(value).protocol), {
    message: 'must be an http(s) URL',
  })
  .transform((value) => new URL(value).origin);

function parseOrigins(value: string, context: z.RefinementCtx): string[] {
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => HttpOrigin.safeParse(entry));
  if (parsed.some((entry) => !entry.success)) {
    context.addIssue({ code: 'custom', message: 'TRUSTED_ORIGINS: comma-separated http(s) URLs' });
    return z.NEVER;
  }
  return parsed.flatMap((entry) => (entry.success ? [entry.data] : []));
}

/**
 * Настройки входа (ADR-0005): три подключения к базе — по роли на каждое — и секрет библиотеки.
 * Всё это секреты: в рабочем окружении они лежат в файле окружения вне репозитория, а здесь только
 * читаются. Значения нигде не печатаются, в том числе в тексте ошибки разбора.
 */
const AuthEnvSchema = z.object({
  /** Приложение: роль homecrm_app, политики «только своё». */
  DATABASE_URL_APP: PostgresUrl,
  /** Служба входа: роль homecrm_auth. */
  DATABASE_URL_AUTH: PostgresUrl,
  /** Обработчик фоновых задач: роль homecrm_worker. */
  DATABASE_URL_WORKER: PostgresUrl,
  /** Шифрует секреты второго фактора и подписывает cookie. Потеря секрета — потеря второго фактора у всех. */
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** Адрес приложения, как его видит браузер: https://home.example. Cookie всегда с Secure. */
  BASE_URL: HttpOrigin,
  /** Откуда ещё принимаются изменяющие запросы с cookie (адрес Vite в разработке). */
  TRUSTED_ORIGINS: z.string().default('').transform(parseOrigins),
});

export type AuthConfig = z.infer<typeof AuthEnvSchema>;

export class ConfigError extends Error {}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const parsed = AuthEnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  // Только имена переменных и причины: ни значений, ни строк подключения (в них пароли).
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new ConfigError(`Invalid sign-in configuration: ${problems.join('; ')}`);
}
