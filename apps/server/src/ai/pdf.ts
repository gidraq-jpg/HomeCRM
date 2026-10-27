import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Failure } from '../objects/support.ts';
import { PDF_MAX_BYTES, PDF_TIMEOUT_MS, PdfReply } from './pdf-protocol.ts';

/** Недоверенные байты не разбираются в процессе HTTP-сервера. */
export async function readPdf(bytes: Buffer, timeoutMs = PDF_TIMEOUT_MS) {
  if (!bytes.length || bytes.length > PDF_MAX_BYTES) throw new Failure(413, 'FILE_TOO_LARGE');
  const result = await new Promise<
    Extract<ReturnType<typeof PdfReply.parse>, { ok: true }>['result']
  >((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./pdf-worker.ts', import.meta.url)), [], {
      execArgv: [
        '--max-old-space-size=192',
        '--disable-proto=throw',
        '--disallow-code-generation-from-strings',
        '--permission',
        '--allow-addons',
        ...[
          '../../../../node_modules/',
          '../../node_modules/',
          '../../../../package.json',
          '../../package.json',
          './pdf-worker.ts',
          './pdf-protocol.ts',
        ].map((path) => `--allow-fs-read=${fileURLToPath(new URL(path, import.meta.url))}`),
      ],
      // Не наследуем секреты сервера, NODE_OPTIONS и настройки прокси.
      env: { NODE_ENV: 'production', PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    let settled = false;
    const finish = (error?: Failure, value?: typeof result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      if (error) reject(error);
      else if (value) resolve(value);
    };
    const timer = setTimeout(
      () => finish(new Failure(422, 'AI_PDF_TIMEOUT')),
      Math.min(Math.max(timeoutMs, 1), PDF_TIMEOUT_MS),
    );
    child.on('message', (message) => {
      const reply = PdfReply.safeParse(message);
      if (!reply.success) finish(new Failure(422, 'AI_PDF_BROKEN'));
      else if (!reply.data.ok) finish(new Failure(422, reply.data.code));
      else finish(undefined, reply.data.result);
    });
    child.on('error', () => finish(new Failure(422, 'AI_PDF_BROKEN')));
    child.on('exit', () => finish(new Failure(422, 'AI_PDF_BROKEN')));
    child.send(bytes.toString('base64'), (error) => {
      if (error) finish(new Failure(422, 'AI_PDF_BROKEN'));
    });
  });
  return { ...result, images: result.images.map((image) => Buffer.from(image, 'base64')) };
}
