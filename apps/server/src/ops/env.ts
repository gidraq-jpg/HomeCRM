// Настройки эксплуатации: миграции, резервные копии и восстановление (R0.11, ADR-0021).
// Читаются из окружения контейнера. Пароли приходят из файлов окружения в E:\HomeCRM-data\secrets
// и нигде не печатаются: ни в журнал, ни в статус, ни в текст ошибки.
import { z } from 'zod';
import { OpsError } from './process.ts';

const Flag = z
  .enum(['0', '1'])
  .default('1')
  .transform((value) => value === '1');

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

export const OpsEnvSchema = z.object({
  DB_HOST: z.string().min(1).default('db'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(5432),
  DB_NAME: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default('homecrm'),
  /** Суперпользователь PostgreSQL: создаёт роли и базу, делает дамп и восстанавливает. Без пароля — только в тестах. */
  DB_ADMIN_USER: z.string().min(1).default('postgres'),
  POSTGRES_PASSWORD: z.string().optional(),
  HOMECRM_OWNER_PASSWORD: z.string().optional(),
  HOMECRM_APP_PASSWORD: z.string().optional(),
  HOMECRM_AUTH_PASSWORD: z.string().optional(),
  HOMECRM_WORKER_PASSWORD: z.string().optional(),

  /** 0 — в этом окружении (предпросмотр, проверка восстановления) копии не делаются, в том числе перед миграцией. */
  BACKUP_ENABLED: Flag,
  /** Локальное хранилище restic: папка внутри контейнера, снаружи — E:\HomeCRM-data\backups\restic. */
  BACKUP_LOCAL_REPOSITORY: z.string().min(1).default('/backups/restic'),
  /** Второе хранилище: `rclone:<remote>:<папка>`, например `rclone:gdrive:HomeCRM-backups`. Не задано — копия одна. */
  BACKUP_CLOUD_REPOSITORY: z
    .string()
    .regex(/^rclone:[A-Za-z0-9_.-]+:.*$/, 'must look like rclone:<remote>:<path>')
    .optional(),
  /** Конфигурация rclone с токеном Google: смонтирована только для чтения. */
  RCLONE_CONFIG_SOURCE: z.string().min(1).default('/run/rclone/rclone.conf'),
  RESTIC_PASSWORD_FILE: z.string().min(1).default('/run/secrets/restic-password'),
  /** Отметки о последней копии и проверке восстановления; снаружи — E:\HomeCRM-data\backups\status. */
  BACKUP_STATUS_DIR: z.string().min(1).default('/status'),
  BACKUP_STAGE_DIR: z.string().min(1).default('/tmp/homecrm-backup-stage'),
  /** Файлы приложения (R0.5): входят в копию, если папка есть. */
  FILES_DIR: z.string().min(1).default('/data/files'),
  BACKUP_TIME: Time.default('03:30'),
  /** Имя узла в снимках restic: по нему выбирается «последний» снимок. */
  BACKUP_HOST: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .default('homecrm'),
  /**
   * `required` — копия перед миграцией обязана попасть и в облако, если оно настроено;
   * `skip` — для выпуска без интернета достаточно локальной копии. Явная команда владельца.
   */
  BACKUP_PRE_MIGRATION_CLOUD: z.enum(['required', 'skip']).default('required'),
  HOME_TIME_ZONE: z.string().default('Asia/Yekaterinburg'),
  APP_VERSION: z.string().default('dev'),
});

export type OpsEnv = z.infer<typeof OpsEnvSchema>;

export function loadOpsEnv(env: NodeJS.ProcessEnv = process.env): OpsEnv {
  const parsed = OpsEnvSchema.safeParse(env);
  if (parsed.success) return parsed.data;
  // Только имена переменных и причины: значения могут быть паролями.
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
  );
  throw new OpsError(`Invalid operations configuration: ${problems.join('; ')}`);
}

/** Адрес подключения к базе; пароль, если есть, кодируется. */
export function databaseUrl(
  env: OpsEnv,
  user: string,
  password: string | undefined,
  database: string,
): string {
  const url = new URL('postgres://placeholder');
  url.hostname = env.DB_HOST;
  url.port = String(env.DB_PORT);
  url.username = user;
  if (password !== undefined && password !== '') url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

export function adminUrl(env: OpsEnv, database: string): string {
  return databaseUrl(env, env.DB_ADMIN_USER, env.POSTGRES_PASSWORD, database);
}

/** Переменные для pg_dump и pg_restore: пароль не попадает в аргументы командной строки. */
export function pgEnv(env: OpsEnv, database: string): Record<string, string> {
  return {
    PGHOST: env.DB_HOST,
    PGPORT: String(env.DB_PORT),
    PGUSER: env.DB_ADMIN_USER,
    PGDATABASE: database,
    ...(env.POSTGRES_PASSWORD ? { PGPASSWORD: env.POSTGRES_PASSWORD } : {}),
  };
}
