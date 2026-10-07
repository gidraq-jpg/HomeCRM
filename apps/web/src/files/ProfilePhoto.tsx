import { Camera, Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { saveProfile } from '../household/api.ts';
import { useRefresh } from '../household/queries.ts';
import { createNote, fetchNotes } from '../notes/api.ts';
import { useToast } from '../ui/Toast.tsx';
import { type FileParent, uploadFile } from './api.ts';
import { fileErrorMessage } from './errors.ts';
import { IMAGE_ACCEPT } from './FilesSection.tsx';
import { classify, MAX_FILE_BYTES, prepareForUpload } from './prepare.ts';

/**
 * Служебная личная заметка, в которой лежат фото профиля. API хранит файл только у заметки или
 * объекта, отдельного маршрута для фото профиля нет (docs/files-api.md), поэтому заметка
 * находится по названию, а если её нет — создаётся.
 */
export const PHOTO_NOTE_TITLE = 'Фото профиля';
const PHOTO_NOTE_BODY =
  'Здесь хранятся ваши фото профиля. Если удалить заметку, фото пропадёт из профиля.';

/** Ошибка, найденная до отправки: её текст уже готов для показа. */
class PhotoProblem extends Error {}

async function photoParent(): Promise<FileParent> {
  const own = await fetchNotes('personal', { trash: false, offset: 0 });
  const found = own.find((note) => note.title === PHOTO_NOTE_TITLE);
  if (found) return { kind: 'note', id: found.id };
  const created = await createNote({
    title: PHOTO_NOTE_TITLE,
    body: PHOTO_NOTE_BODY,
    pinned: false,
    checklist: [],
  });
  return { kind: 'note', id: created.id };
}

/** Кнопки «Загрузить фото», «Сменить фото» и «Убрать фото» в «Обо мне» (SPACE-10). */
export function ProfilePhoto({ photoFileId }: { photoFileId: string | null }) {
  const refresh = useRefresh();
  const toast = useToast();
  const state = useAction();
  const picker = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<string | null>(null);

  function choose(file: File | undefined) {
    if (file === undefined) return;
    void state.run(async () => {
      try {
        if (classify(file) !== 'image') {
          throw new PhotoProblem('Для фото профиля нужно изображение: JPEG, PNG, WebP или HEIC.');
        }
        setStep('Готовим фото…');
        const prepared = await prepareForUpload(file);
        if (prepared.size > MAX_FILE_BYTES) {
          throw new PhotoProblem('Фото больше 25 МБ. Выберите файл поменьше.');
        }
        const parent = await photoParent();
        setStep('Загружаем фото… 0 %');
        const uploaded = await uploadFile(parent, prepared, {
          onProgress: (fraction) => setStep(`Загружаем фото… ${Math.round(fraction * 100)} %`),
        });
        await saveProfile({ photoFileId: uploaded.id });
        await refresh.profile();
        await refresh.members();
        toast.show({ message: 'Фото профиля обновлено' });
      } finally {
        setStep(null);
      }
    });
  }

  function remove() {
    void state.run(async () => {
      await saveProfile({ photoFileId: null });
      await refresh.profile();
      await refresh.members();
      toast.show({ message: 'Фото убрано' });
    });
  }

  return (
    <div className="profile-photo">
      <input
        ref={picker}
        type="file"
        hidden
        accept={IMAGE_ACCEPT}
        onChange={(event) => {
          choose(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          disabled={state.disabled}
          onClick={() => picker.current?.click()}
        >
          <Camera size={20} aria-hidden />
          {photoFileId === null ? 'Загрузить фото' : 'Сменить фото'}
        </button>
        {photoFileId !== null ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled}
            onClick={remove}
          >
            <Trash size={20} aria-hidden />
            Убрать фото
          </button>
        ) : null}
      </div>
      {step !== null ? (
        <p className="muted" role="status">
          {step}
        </p>
      ) : null}
      {state.error ? (
        <Notice error>
          {state.error instanceof PhotoProblem
            ? state.error.message
            : fileErrorMessage(state.error, 'photo')}
        </Notice>
      ) : null}
    </div>
  );
}
