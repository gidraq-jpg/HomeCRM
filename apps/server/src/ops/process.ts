// Запуск внешних программ (pg_dump, pg_restore, restic) и журнал операций.
import { spawn } from 'node:child_process';

export interface Log {
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** Журнал в стандартный вывод, по строке JSON: так же, как у сервера. Секреты в поля не передаются. */
export function createLog(write: (line: string) => void = (line) => console.log(line)): Log {
  const emit =
    (level: string) =>
    (message: string, fields: Record<string, unknown> = {}) =>
      write(JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...fields }));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const silentLog: Log = { info() {}, warn() {}, error() {} };

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: Record<string, string>;
  timeoutMs?: number;
}

/** Запускает программу без оболочки. Аргументы не должны содержать секретов: они видны в списке процессов. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      const code = errorCode(error);
      reject(new OpsError(`${command} could not be started${code ? ` (${code})` : ''}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

/**
 * Ошибка с заведомо безопасным текстом: только наши слова, коды и имена этапов. Именно такой текст
 * разрешено писать в журнал и в отметки о копиях и проверках (PRD, раздел 13).
 */
export class OpsError extends Error {}

/** Сбой внешней программы: этап и код выхода. Её собственный вывод не используется никогда:
 *  pg_restore и restic в сообщениях об ошибках цитируют строки данных и имена файлов. */
export function commandFailure(
  command: string,
  stage: string,
  code: number,
  hint?: string,
): OpsError {
  return new OpsError(
    `${command} failed at ${stage} (exit code ${code})${hint === undefined ? '' : `: ${hint}`}`,
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  if (typeof code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(code)) return code;
  return cause === undefined ? undefined : errorCode(cause);
}

/**
 * Текст ошибки для журнала и статуса. Свои ошибки (OpsError) — как есть. Чужие (драйвер базы, Drizzle,
 * Node) — только код: SQLSTATE или системный, потому что их сообщения могут содержать SQL, значения
 * строк и строки подключения.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof OpsError) return error.message;
  const code = errorCode(error);
  return code === undefined ? 'unexpected error' : `unexpected error (code ${code})`;
}
