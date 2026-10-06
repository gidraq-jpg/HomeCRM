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
