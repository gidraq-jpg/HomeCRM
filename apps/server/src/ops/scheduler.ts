// Расписание копий: контейнер `backup` раз в минуту решает, пора ли (ADR-0021).
// Выбран контейнер, а не планировщик Windows: он работает вместе с Docker и после перезагрузки,
// не зависит от настроек учётной записи и переезжает на VPS вместе с compose.
import { checkRepositories, runBackup } from './backup.ts';
import type { OpsEnv } from './env.ts';
import { errorMessage, type Log } from './process.ts';
import { BACKUP_STATUS_FILE, type BackupStatus, readStatus } from './status.ts';

const HOUR = 3_600_000;
/** Если последняя удачная копия старше — копия просрочена (компьютер был выключен): делаем сразу. */
const OVERDUE_MS = 26 * HOUR;
/** После неудачи следующая попытка — не раньше, чем через полчаса. */
const RETRY_MS = 0.5 * HOUR;
const CHECK_INTERVAL_MS = 7 * 24 * HOUR;
const CHECK_TIME = '04:30';

export interface LocalTime {
  date: string;
  minutes: number;
}

/** Дата и время суток в часовом поясе дома. */
export function localTime(now: Date, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

function toMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

export type DueAction = 'backup' | 'check' | undefined;

/**
 * Что делать сейчас. Копия — после BACKUP_TIME, если сегодня удачной ещё не было, или сразу, если
 * последняя удачная старше 26 часов. После сбоя — повтор не чаще раза в полчаса. Проверка
 * целостности хранилищ — раз в неделю после 4:30.
 */
export function dueAction(now: Date, status: BackupStatus | undefined, env: OpsEnv): DueAction {
  const lastSuccess = status?.lastSuccessAt ? Date.parse(status.lastSuccessAt) : undefined;
  const lastAttempt = status?.lastAttemptAt ? Date.parse(status.lastAttemptAt) : undefined;
  const local = localTime(now, env.HOME_TIME_ZONE);
  const retryReady =
    lastAttempt === undefined ||
    lastSuccess === undefined ||
    lastAttempt <= lastSuccess ||
    now.getTime() - lastAttempt >= RETRY_MS;

  const overdue = lastSuccess === undefined || now.getTime() - lastSuccess > OVERDUE_MS;
  const successToday =
    lastSuccess !== undefined &&
    localTime(new Date(lastSuccess), env.HOME_TIME_ZONE).date === local.date;
  const scheduled = local.minutes >= toMinutes(env.BACKUP_TIME) && !successToday;
  if ((overdue || scheduled) && retryReady) return 'backup';

  const lastCheck = status?.lastCheckAt ? Date.parse(status.lastCheckAt) : undefined;
  const checkDue = lastCheck === undefined || now.getTime() - lastCheck >= CHECK_INTERVAL_MS;
  if (checkDue && local.minutes >= toMinutes(CHECK_TIME)) return 'check';
  return undefined;
}

/** Бесконечный цикл контейнера `backup`. Ошибка одной итерации не останавливает расписание. */
export async function runScheduler(env: OpsEnv, log: Log): Promise<never> {
  log.info('backup scheduler started', {
    time: env.BACKUP_TIME,
    timeZone: env.HOME_TIME_ZONE,
    cloud: env.BACKUP_CLOUD_REPOSITORY !== undefined,
  });
  if (env.BACKUP_CLOUD_REPOSITORY === undefined) {
    log.warn('the second copy is not configured: backups are kept in one place only');
  }
  for (;;) {
    try {
      const status = await readStatus<BackupStatus>(env.BACKUP_STATUS_DIR, BACKUP_STATUS_FILE);
      const action = dueAction(new Date(), status, env);
      if (action === 'backup') await runBackup({ env, kind: 'daily', log });
      else if (action === 'check') await checkRepositories(env, log);
    } catch (error) {
      log.error('scheduler iteration failed', { error: errorMessage(error) });
    }
    await new Promise((resolve) => setTimeout(resolve, 60_000));
  }
}
