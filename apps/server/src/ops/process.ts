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
      reject(new Error(`${command}: ${error.message}`));
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

/** Последние строки вывода программы для сообщения об ошибке. */
export function tail(text: string, lines = 6): string {
  return text.trim().split(/\r?\n/).slice(-lines).join(' | ');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
