import { UploadSimple } from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import { useAction } from '../auth/components.tsx';
import { uploadFile } from '../files/api.ts';
import { fileErrorMessage, LOCAL_MESSAGES } from '../files/errors.ts';
import { FILE_ACCEPT } from '../files/FilesSection.tsx';
import { localProblem, MAX_FILE_BYTES, prepareForUpload } from '../files/prepare.ts';
import type { ObjectCard } from '../objects/api.ts';
import { useRefreshObjects } from '../objects/queries.ts';

interface ReceiptFieldProps {
  /** Объект: файл квитанции или чека должен быть живым файлом этого объекта. */
  card: Pick<ObjectCard, 'id' | 'files'>;
  label: string;
  /** Идентификатор выбранного файла; пусто — без файла. */
  value: string;
  onChange: (fileId: string) => void;
  disabled?: boolean;
}

/**
 * Файл квитанции или чека: выбирается из файлов объекта или загружается тут же. Название файла
 * показывается только на экране; в адрес, журнал и хранилища оно не попадает.
 */
export function ReceiptField({
  card,
  label,
  value,
  onChange,
  disabled = false,
}: ReceiptFieldProps) {
  const selectId = useId();
  const refresh = useRefreshObjects();
  const upload = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState<{ id: string; name: string }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const live = card.files.filter((file) => file.deletedAt === null);
  const options = [
    ...live.map((file) => ({ id: file.id, name: file.name })),
    ...added.filter((file) => !live.some((item) => item.id === file.id)),
  ];

  function pick(file: File | undefined) {
    if (file === undefined) return;
    const local = localProblem(file);
    if (local !== null) {
      setProblem(LOCAL_MESSAGES[local]);
      return;
    }
    setProblem(null);
    void upload.run(async () => {
      try {
        const prepared = await prepareForUpload(file);
        if (prepared.size > MAX_FILE_BYTES) {
          setProblem(LOCAL_MESSAGES.size);
          return;
        }
        const meta = await uploadFile({ kind: 'object', id: card.id }, prepared);
        setAdded((previous) => [...previous, { id: meta.id, name: meta.name }]);
        onChange(meta.id);
        await refresh();
      } catch (failure) {
        setProblem(fileErrorMessage(failure, 'upload'));
      } finally {
        if (input.current) input.current.value = '';
      }
    });
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className="select"
        value={value}
        disabled={disabled || upload.pending}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Без файла</option>
        {options.map((file) => (
          <option key={file.id} value={file.id}>
            {file.name}
          </option>
        ))}
      </select>
      <input
        ref={input}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        aria-label={`${label}: новый файл`}
        onChange={(event) => pick(event.currentTarget.files?.[0])}
      />
      <button
        type="button"
        className="btn btn--secondary btn--block receipt-upload"
        disabled={disabled || upload.pending}
        onClick={() => input.current?.click()}
      >
        <UploadSimple size={20} aria-hidden />
        {upload.pending ? 'Загружаем…' : 'Загрузить файл'}
      </button>
      {problem === null ? (
        <p className="field__hint">Фото или PDF; файл появится и на вкладке «Файлы» объекта.</p>
      ) : (
        <p className="field__error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}
