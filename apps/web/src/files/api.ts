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
/** PDF на экране: сервер отдаёт его с `Content-Disposition: inline` и песочницей без разрешений. */
export const inlineUrl = (id: string) => `/api/files/${id}?inline=1`;

/** Удалённый файл живой записи: сервер сам говорит, можно ли его вернуть. */
export const DeletedFile = FileMeta.extend({ canRestore: z.boolean() });
export type DeletedFile = z.infer<typeof DeletedFile>;

/** Строка общей корзины файлов: к чему относился файл и можно ли его вернуть. */
export const TrashedFile = FileMeta.extend({
  parentType: z.enum(['note', 'object', 'profile']),
  parentId: z.string(),
  canRestore: z.boolean(),
});
export type TrashedFile = z.infer<typeof TrashedFile>;

export function trashFile(parent: FileParent, fileId: string) {
  return apiRequest('POST', `${collection(parent)}/${fileId}/trash`, FileMeta, {});
}

export function restoreFile(parent: FileParent, fileId: string) {
  return apiRequest('POST', `${collection(parent)}/${fileId}/restore`, FileMeta, {});
}

/** Отдельно удалённые файлы живой записи (`?deleted=1`), в том числе после перезагрузки страницы. */
export function fetchDeletedFiles(parent: FileParent, signal?: AbortSignal) {
  return apiRequest(
    'GET',
    `${collection(parent)}?deleted=1`,
    z.array(DeletedFile),
    undefined,
    signal,
  );
}

/** Общая корзина файлов: отдельно удалённые файлы записей и снятые фото своего профиля. */
export function fetchTrashedFiles(signal?: AbortSignal) {
  return apiRequest('GET', 'files/trash', z.array(TrashedFile), undefined, signal);
}

// ---- Фото профиля (ADR-0026)

/** Снять своё фото: файл остаётся в корзине 30 дней. */
export function removeProfilePhoto() {
  return apiRequest('DELETE', 'me/profile/photo', z.unknown());
}

/** Вернуть снятое или заменённое фото: оно снова становится текущим. */
export function restoreProfilePhoto(fileId: string) {
  return apiRequest('POST', `me/profile/photo/${fileId}/restore`, FileMeta, {});
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
  return send(collection(parent), file, options);
}

/** Загрузка нового фото профиля: сервер заменяет текущее, прежнее уходит в корзину. */
export function uploadProfilePhoto(file: File, options: UploadOptions = {}): Promise<FileMeta> {
  return send('me/profile/photo', file, options);
}

function send(path: string, file: File, options: UploadOptions): Promise<FileMeta> {
  return new Promise((resolve, reject) => {
    const { signal, onProgress } = options;
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const request = new XMLHttpRequest();
    request.open('POST', `/api/${path}`);
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
