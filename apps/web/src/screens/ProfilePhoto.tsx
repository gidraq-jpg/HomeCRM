import { ArrowCounterClockwise, Camera, Trash } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import {
  isAbort,
  removeProfilePhoto,
  restoreProfilePhoto,
  uploadProfilePhoto,
} from '../files/api.ts';
import { fileErrorMessage, LOCAL_MESSAGES } from '../files/errors.ts';
import { Thumbnail } from '../files/FilesSection.tsx';
import { classify, localProblem, MAX_FILE_BYTES, prepareForUpload } from '../files/prepare.ts';
import { useRefreshFiles, useTrashedFiles } from '../files/queries.ts';
import { formatFileSize } from '../files/size.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useRefresh } from '../household/queries.ts';
import { Section } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';

/** Что предлагает окно выбора для фото профиля: только изображения. */
const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';
/** Корзина хранит снятое 30 дней (DATA-1). */
const RETENTION_DAYS = 30;
const UNDO_MS = 7000;

type Phase = { step: 'preparing' } | { step: 'uploading'; progress: number };

function keepUntil(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000);
}

/**
 * Фото профиля (SPACE-10, ADR-0026): загрузить, сменить, снять и вернуть снятое. Фото видят
 * все в доме, прежние фото — только владелец. Файл уменьшается на телефоне, как у вложений.
 * Имя файла живёт только в памяти страницы: в адрес, журнал и localStorage оно не попадает.
 */
export function ProfilePhoto({ photoFileId }: { photoFileId: string | null }) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefresh();
  const refreshFiles = useRefreshFiles();
  const trashed = useTrashedFiles();
  const picker = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const quick = useAction();

  // Уход с экрана прерывает отправку.
  useEffect(() => () => controller.current?.abort(), []);

  const previous = (trashed.data ?? []).filter((file) => file.parentType === 'profile');
  const busy = phase !== null;

  const reload = () => Promise.all([refresh.profile(), refresh.members(), refreshFiles()]);

  async function upload(file: File) {
    setMessage(null);
    const kind = classify(file);
    if (kind !== 'image') {
      setMessage(LOCAL_MESSAGES.photo);
      return;
    }
    const problem = localProblem(file);
    if (problem !== null) {
      setMessage(LOCAL_MESSAGES[problem]);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    try {
      setPhase({ step: 'preparing' });
      const prepared = await prepareForUpload(file);
      if (abort.signal.aborted) return;
      if (prepared.size > MAX_FILE_BYTES) {
        setMessage(LOCAL_MESSAGES.size);
        return;
      }
      setPhase({ step: 'uploading', progress: 0 });
      await uploadProfilePhoto(prepared, {
        signal: abort.signal,
        onProgress: (progress) => setPhase({ step: 'uploading', progress }),
      });
      await reload();
      toast.show({ message: 'Фото обновлено', detail: 'Его видят все в доме.' });
    } catch (error) {
      if (!isAbort(error)) setMessage(fileErrorMessage(error, 'photo'));
    } finally {
      controller.current = null;
      setPhase(null);
    }
  }

  function remove() {
    const removedId = photoFileId;
    void quick.run(async () => {
      setMessage(null);
      await removeProfilePhoto();
      await reload();
      toast.show({
        message: 'Фото снято',
        detail: 'Хранится 30 дней: вернуть его можно ниже, в «Прежних фото».',
        durationMs: UNDO_MS,
        ...(removedId === null
          ? {}
          : {
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreProfilePhoto(removedId)
                    .then(() => reload())
                    .then(() => toast.show({ message: 'Фото возвращено' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть фото',
                        detail: 'Оно осталось в «Прежних фото» ниже.',
                      }),
                    );
                },
              },
            }),
      });
    });
  }

  function restore(id: string) {
    void quick.run(async () => {
      setMessage(null);
      await restoreProfilePhoto(id);
      await reload();
      toast.show({ message: 'Фото возвращено', detail: 'Его снова видят все в доме.' });
    });
  }

  const percent = phase?.step === 'uploading' ? Math.round(phase.progress * 100) : 0;

  return (
    <Section title="Фото">
      <input
        ref={picker}
        type="file"
        className="file-input"
        accept={PHOTO_ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Тот же файл можно выбрать снова.
          event.currentTarget.value = '';
          if (file) void upload(file);
        }}
      />
      <p className="muted">
        Фото (JPEG, PNG, WebP, HEIC) до 25 МБ. Его видят все в доме, включая детей.
      </p>
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || quick.disabled}
          onClick={() => picker.current?.click()}
        >
          <Camera size={20} aria-hidden />
          {photoFileId === null ? 'Загрузить фото' : 'Сменить фото'}
        </button>
        {photoFileId !== null ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || quick.disabled}
            onClick={remove}
          >
            <Trash size={20} aria-hidden />
            {quick.pending ? 'Снимаем…' : 'Убрать фото'}
          </button>
        ) : null}
      </div>

      {phase !== null ? (
        <div className="photo-progress" role="status">
          <span className="file-row__meta">
            {phase.step === 'preparing' ? 'Готовим фото…' : `Загружаем… ${percent} %`}
          </span>
          {phase.step === 'uploading' ? (
            <progress
              className="upload-row__bar"
              max={100}
              value={percent}
              aria-label="Загрузка фото"
            />
          ) : null}
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => controller.current?.abort()}
          >
            Отменить
          </button>
        </div>
      ) : null}

      {message !== null ? <Notice error>{message}</Notice> : null}
      {quick.error ? <Notice error>{fileErrorMessage(quick.error, 'photo')}</Notice> : null}

      {trashed.isError ? (
        <>
          <Notice error>
            Не удалось загрузить прежние фото. Проверьте подключение и повторите.
          </Notice>
          <button className="text-button" type="button" onClick={() => void trashed.refetch()}>
            Повторить загрузку прежних фото
          </button>
        </>
      ) : null}

      {previous.length > 0 ? (
        <div className="file-trash">
          <h3 className="file-trash__title">Прежние фото</h3>
          <p className="muted">
            Снятые и заменённые фото хранятся 30 дней и видны только вам. Вернуть можно любое.
          </p>
          <ul className="file-list" aria-label="Прежние фото">
            {previous.map((file) => (
              <li className="file-row" key={file.id}>
                <div className="file-row__main">
                  <span className="file-row__thumb">
                    <Thumbnail file={file} />
                  </span>
                  <span className="file-row__text">
                    <span className="file-row__name">Фото профиля</span>
                    <span className="file-row__meta">
                      {formatFileSize(file.sizeBytes)} · снято{' '}
                      {formatDay(file.deletedAt ?? file.createdAt, me.timeZone)}, хранится до{' '}
                      {formatDay(keepUntil(file.deletedAt ?? file.createdAt), me.timeZone)}
                    </span>
                  </span>
                </div>
                <div className="file-row__actions">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busy || quick.disabled}
                    aria-label={`Вернуть фото от ${formatDay(file.createdAt, me.timeZone)}`}
                    onClick={() => restore(file.id)}
                  >
                    <ArrowCounterClockwise size={20} aria-hidden />
                    Вернуть
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
