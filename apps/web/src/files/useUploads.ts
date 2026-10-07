import { useCallback, useEffect, useRef, useState } from 'react';
import { type FileParent, isAbort, uploadFile } from './api.ts';
import { fileErrorMessage, LOCAL_MESSAGES } from './errors.ts';
import { localProblem, MAX_FILE_BYTES, prepareForUpload } from './prepare.ts';

export type UploadStatus = 'waiting' | 'preparing' | 'uploading' | 'failed';

export interface UploadItem {
  key: number;
  /** Имя только для показа на экране: в журнал, адрес и хранилища оно не попадает. */
  name: string;
  status: UploadStatus;
  /** 0…1 */
  progress: number;
  /** Готовый текст ошибки. */
  message: string | null;
  /** Ошибку сервера или сети можно повторить; негодный файл — нет. */
  retryable: boolean;
}

interface Entry extends UploadItem {
  file: File;
}

/**
 * Очередь загрузки: файлы уходят по одному. Ошибка одного файла очередь не останавливает,
 * отмена убирает файл из очереди или прерывает отправку.
 */
export function useUploads(parent: FileParent, onUploaded: () => void) {
  const entries = useRef<Entry[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const running = useRef(false);
  const controllers = useRef(new Map<number, AbortController>());
  const counter = useRef(0);
  const parentRef = useRef(parent);
  parentRef.current = parent;
  const notify = useRef(onUploaded);
  notify.current = onUploaded;
  const alive = useRef(true);

  const publish = useCallback(() => {
    if (!alive.current) return;
    setItems(
      entries.current.map(({ key, name, status, progress, message, retryable }) => ({
        key,
        name,
        status,
        progress,
        message,
        retryable,
      })),
    );
  }, []);

  const patch = useCallback(
    (key: number, change: Partial<Entry>) => {
      const entry = entries.current.find((item) => item.key === key);
      if (entry === undefined) return;
      Object.assign(entry, change);
      publish();
    },
    [publish],
  );

  const remove = useCallback(
    (key: number) => {
      entries.current = entries.current.filter((item) => item.key !== key);
      publish();
    },
    [publish],
  );

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = entries.current.find((item) => item.status === 'waiting');
        if (next === undefined || !alive.current) break;
        const controller = new AbortController();
        controllers.current.set(next.key, controller);
        try {
          patch(next.key, { status: 'preparing', progress: 0 });
          const prepared = await prepareForUpload(next.file);
          if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
          if (prepared.size > MAX_FILE_BYTES) {
            patch(next.key, { status: 'failed', message: LOCAL_MESSAGES.size, retryable: false });
            continue;
          }
          patch(next.key, { status: 'uploading' });
          await uploadFile(parentRef.current, prepared, {
            signal: controller.signal,
            onProgress: (fraction) => patch(next.key, { progress: fraction }),
          });
          remove(next.key);
          notify.current();
        } catch (error) {
          if (isAbort(error)) remove(next.key);
          else {
            patch(next.key, {
              status: 'failed',
              message: fileErrorMessage(error, 'upload'),
              retryable: true,
            });
          }
        } finally {
          controllers.current.delete(next.key);
        }
      }
    } finally {
      running.current = false;
    }
  }, [patch, remove]);

  /** Добавляет файлы в очередь; негодные сразу получают понятную ошибку. */
  const add = useCallback(
    (files: File[]) => {
      for (const file of files) {
        counter.current += 1;
        const problem = localProblem(file);
        entries.current.push({
          key: counter.current,
          file,
          name: file.name,
          status: problem === null ? 'waiting' : 'failed',
          progress: 0,
          message: problem === null ? null : LOCAL_MESSAGES[problem],
          retryable: false,
        });
      }
      publish();
      void pump();
    },
    [publish, pump],
  );

  /** Убрать из очереди или прервать отправку. */
  const cancel = useCallback(
    (key: number) => {
      const controller = controllers.current.get(key);
      if (controller) controller.abort();
      else remove(key);
    },
    [remove],
  );

  /** Ещё раз отправить файл, который не ушёл. */
  const retry = useCallback(
    (key: number) => {
      patch(key, { status: 'waiting', progress: 0, message: null, retryable: false });
      void pump();
    },
    [patch, pump],
  );

  useEffect(() => {
    alive.current = true;
    const active = controllers.current;
    return () => {
      alive.current = false;
      for (const controller of active.values()) controller.abort();
    };
  }, []);

  return { items, add, cancel, retry };
}
