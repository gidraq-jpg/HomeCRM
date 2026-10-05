// Настройки сервера из переменных окружения. Секреты сюда попадут из файла в E:\HomeCRM-data\secrets.
import { z } from 'zod';

const EnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  // 8310 — разработка; в рабочем окружении 8300, в предпросмотре 8301 (план, раздел 2.2).
  PORT: z.coerce.number().int().min(1).max(65535).default(8310),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_VERSION: z.string().min(1).default('dev'),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return EnvSchema.parse(env);
}
