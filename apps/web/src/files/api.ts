import * as z from 'zod';
import { ApiError, apiRequest } from '../auth/api.ts';

// Файлы записей — ADR-0024, docs/files-api.md. Ключи хранения и конверты клиенту не приходят.
// Файл скачивается только по /api/files/:id с сессией: публичных ссылок нет. Названия файлов
// живут только в ответах и памяти страницы: в адреса, журнал и localStorage они не попадают.

export const FileMeta = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  hasPreview: z.boolean(),
  authorId: z.string(),
  createdAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type FileMeta = z.infer<typeof FileMeta>;

/** К чему прикреплён файл: заметка или объект. */
export type ParentKind = 'note' | 'object';
export interface FileParent {
  kind: ParentKind;
  id: string;
}

const collection = (parent: FileParent) =>
  `${parent.kind === 'note' ? 'notes' : 'objects'}/${parent.id}/files`;

/** Адрес основного файла: в адресе только идентификатор, имени файла в нём нет. */
export const fileUrl = (id: string) => `/api/files/${id}`;
/** Адрес превью (WebP до 480 px); у PDF превью нет. */
export const previewUrl = (id: string) => `/api/files/${id}/preview`;

export function trashFile(parent: FileParent, fileId: string) {
  return apiRequest('POST', `${collection(parent)}/${fileId}/trash`, FileMeta, {});
}

export function restoreFile(parent: FileParent, fileId: string) {
  return apiRequest('POST', `${collection(parent)}/${fileId}/restore`, FileMeta, {});
}

export interface UploadOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const Failure = z.object({ code: z.string().optional() });

/**
 * Загрузка одного файла. Через XMLHttpRequest, а не fetch: только он сообщает о ходе отправки.
 * Cookie сессии уходят сами (тот же источник), заголовок Origin ставит браузер.
 */
export function uploadFile(
  parent: FileParent,
  file: File,
  options: UploadOptions = {},
): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    request.open('POST', `/api/${collection(parent)}`);
    request.responseType = 'text';
    request.withCredentials = true;
    const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const done = () => signal?.removeEventListener('abort', abort);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    });
    request.addEventListener('abort', () => {
      done();
      reject(new DOMException('Aborted', 'AbortError'));
    });
    request.addEventListener('error', () => {
      done();
      reject(new ApiError(0, 'NETWORK'));
    });
    request.addEventListener('load', () => {
      done();
      let json: unknown = null;
      try {
        json = JSON.parse(request.responseText);
      } catch {
        json = null;
      }
      if (request.status < 200 || request.status >= 300) {
        const failure = Failure.safeParse(json);
        reject(new ApiError(request.status, failure.success ? (failure.data.code ?? '') : ''));
        return;
      }
      const result = FileMeta.safeParse(json);
      if (!result.success) {
        reject(new ApiError(502, 'INVALID_RESPONSE'));
        return;
      }
      resolve(result.data);
    });

    const body = new FormData();
    body.append('file', file, file.name);
    request.send(body);
  });
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
