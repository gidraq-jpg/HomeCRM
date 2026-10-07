import { canRestore, canTrash } from '@homecrm/shared';
import {
  ArrowCounterClockwise,
  DownloadSimple,
  Eye,
  FilePdf,
  Files,
  ImageSquare,
  Plus,
  Trash,
  X,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, type PlacedRecord, viewerOf } from '../notes/abilities.ts';
import { usePersonName } from '../objects/context.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useToast } from '../ui/Toast.tsx';
import {
  type FileMeta,
  type FileParent,
  fileUrl,
  inlineUrl,
  previewUrl,
  restoreFile,
  trashFile,
} from './api.ts';
import { fileErrorMessage } from './errors.ts';
import { useDeletedFiles, useRefreshFiles } from './queries.ts';
import { formatFileSize } from './size.ts';
import { type UploadItem, useUploads } from './useUploads.ts';

/** Типы, которые предлагает окно выбора файла. Сервер всё равно проверяет содержимое. */
export const FILE_ACCEPT =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,application/pdf,.pdf';

const fileCount = (count: number) => countWord(count, ['файл', 'файла', 'файлов']);
/** Сколько секунд даётся на отмену (TASK-7). */
const UNDO_MS = 7000;

export interface FilesCard extends PlacedRecord {
  files: FileMeta[];
}

/** Файл в списке: у удалённых живой записи сервер добавляет `canRestore`. */
type ListedFile = FileMeta & { canRestore?: boolean };

interface FilesSectionProps {
  parent: FileParent;
  card: FilesCard;
  /** Можно ли добавлять файлы: право править запись (`canWrite`). */
  canAdd: boolean;
  /** Перечитать карточку после изменения. */
  refresh: () => Promise<unknown>;
}

export function isImage(file: Pick<FileMeta, 'mimeType'>) {
  return file.mimeType.startsWith('image/');
}

export function isPdf(file: Pick<FileMeta, 'mimeType'>) {
  return file.mimeType === 'application/pdf';
}

export function Thumbnail({ file }: { file: Pick<FileMeta, 'id' | 'mimeType' | 'hasPreview'> }) {
  const [broken, setBroken] = useState(false);
  if (file.hasPreview && !broken) {
    return (
      <img
        className="file-row__image"
        src={previewUrl(file.id)}
        alt=""
        width={56}
        height={56}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return isImage(file) ? <ImageSquare size={28} aria-hidden /> : <FilePdf size={28} aria-hidden />;
}

function FileRow({
  file,
  parent,
  card,
  refresh,
}: {
  file: ListedFile;
  parent: FileParent;
  card: FilesCard;
  /** Перечитать карточку и списки удалённых файлов. */
  refresh: () => Promise<unknown>;
}) {
  const { me } = useHousehold();
  const nameOf = usePersonName();
  const toast = useToast();
  const state = useAction();
  const [viewing, setViewing] = useState(false);

  const viewer = viewerOf(me);
  const deleted = file.deletedAt !== null;
  const parentTrashed = card.deletedAt !== null;
  const facts = {
    ...factsOf(card, viewer, parent.kind === 'note' ? 'note_file' : 'object_file'),
    authorId: file.authorId,
    trashed: deleted,
  };
  const mayTrash = !deleted && !parentTrashed && canTrash(viewer, facts);
  // Удалённый файл возвращает тот, кому это разрешает сервер (`canRestore` в списке).
  const mayRestore = deleted && !parentTrashed && file.canRestore === true;
  // Отмена в уведомлении нужна только тому, кто потом сможет вернуть файл.
  const mayUndo = canRestore(viewer, { ...facts, trashed: true });

  function trash() {
    void state.run(async () => {
      await trashFile(parent, file.id);
      await refresh();
      toast.show({
        message: 'Файл в корзине',
        detail: mayUndo
          ? 'Хранится 30 дней'
          : 'Вернуть его сможет автор-взрослый или администратор. Хранится 30 дней.',
        durationMs: UNDO_MS,
        ...(mayUndo
          ? {
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreFile(parent, file.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Файл возвращён' }))
                    .catch(() =>
                      toast.show({
                        message: 'Не удалось вернуть файл',
                        detail: 'Он остался в разделе «Удалённые файлы» этой записи.',
                      }),
                    );
                },
              },
            }
          : {}),
      });
    });
  }

  function restore() {
    void state.run(async () => {
      await restoreFile(parent, file.id);
      await refresh();
      toast.show({ message: 'Файл возвращён' });
    });
  }

  const meta = [
    formatFileSize(file.sizeBytes),
    formatDay(file.createdAt, me.timeZone),
    nameOf(file.authorId),
  ].join(' · ');

  return (
    <li className={deleted ? 'file-row file-row--deleted' : 'file-row'}>
      <div className="file-row__main">
        <span className="file-row__thumb">
          <Thumbnail file={file} />
        </span>
        <span className="file-row__text">
          <span className="file-row__name">{file.name}</span>
          <span className="file-row__meta">{meta}</span>
        </span>
      </div>
      <div className="file-row__actions">
        {isImage(file) && !deleted ? (
          <button
            type="button"
            className="btn btn--secondary"
            aria-label={`Открыть: ${file.name}`}
            onClick={() => setViewing(true)}
          >
            <Eye size={20} aria-hidden />
            Открыть
          </button>
        ) : null}
        {isPdf(file) ? (
          <a
            className="btn btn--secondary"
            href={inlineUrl(file.id)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Открыть PDF в новой вкладке: ${file.name}`}
          >
            <Eye size={20} aria-hidden />
            Открыть
          </a>
        ) : null}
        <a
          className="btn btn--secondary"
          href={fileUrl(file.id)}
          aria-label={`Скачать: ${file.name}`}
          download
        >
          <DownloadSimple size={20} aria-hidden />
          Скачать
        </a>
        {mayTrash ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled}
            aria-label={`В корзину: ${file.name}`}
            onClick={trash}
          >
            <Trash size={20} aria-hidden />В корзину
          </button>
        ) : null}
        {mayRestore ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled}
            aria-label={`Восстановить: ${file.name}`}
            onClick={restore}
          >
            <ArrowCounterClockwise size={20} aria-hidden />
            {state.pending ? 'Возвращаем…' : 'Восстановить'}
          </button>
        ) : null}
      </div>
      {deleted && !mayRestore && !parentTrashed ? (
        <p className="muted file-row__note">
          Вернуть этот файл может его автор-взрослый или администратор.
        </p>
      ) : null}
      {state.error ? (
        <Notice error>{fileErrorMessage(state.error, deleted ? 'restore' : 'trash')}</Notice>
      ) : null}
      {viewing ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setViewing(false);
          }}
          title="Просмотр файла"
          description={`${formatFileSize(file.sizeBytes)} · ${formatDay(file.createdAt, me.timeZone)}`}
        >
          <img className="file-viewer__image" src={fileUrl(file.id)} alt={file.name} />
          <a className="btn btn--secondary btn--block sheet__next" href={fileUrl(file.id)} download>
            <DownloadSimple size={20} aria-hidden />
            Скачать
          </a>
        </Sheet>
      ) : null}
    </li>
  );
}

function UploadRow({
  item,
  onCancel,
  onRetry,
}: {
  item: UploadItem;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const percent = Math.round(item.progress * 100);
  const failed = item.status === 'failed';
  const text =
    item.status === 'waiting'
      ? 'Ждёт очереди'
      : item.status === 'preparing'
        ? 'Готовим файл…'
        : item.status === 'uploading'
          ? `Загружаем… ${percent} %`
          : null;
  return (
    <li className={failed ? 'upload-row upload-row--failed' : 'upload-row'}>
      <div className="upload-row__head">
        <span className="file-row__name">{item.name}</span>
        <button
          type="button"
          className="btn btn--secondary upload-row__cancel"
          aria-label={`${failed ? 'Убрать' : 'Отменить'}: ${item.name}`}
          onClick={onCancel}
        >
          {failed ? <X size={20} aria-hidden /> : null}
          {failed ? 'Убрать' : 'Отменить'}
        </button>
      </div>
      {text !== null ? (
        <>
          <span className="file-row__meta">{text}</span>
          {item.status === 'uploading' ? (
            <progress
              className="upload-row__bar"
              max={100}
              value={percent}
              aria-label={`Загрузка: ${item.name}`}
            />
          ) : null}
        </>
      ) : null}
      {failed ? (
        <>
          <Notice error>{item.message}</Notice>
          {item.retryable ? (
            <button
              type="button"
              className="btn btn--secondary"
              aria-label={`Повторить: ${item.name}`}
              onClick={onRetry}
            >
              Повторить
            </button>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/**
 * Файлы записи (OBJ-4): список с превью, «Добавить файл», просмотр, скачивание и корзина.
 * Файл наследует доступ записи: чего не видно в записи, того нет и здесь. Скачивается файл
 * только через `/api/files/:id` с сессией, публичных ссылок нет. PDF открывается в новой вкладке
 * через `?inline=1`. «Удалённые файлы» приходят от сервера, поэтому видны и после перезагрузки.
 */
export function FilesSection({ parent, card, canAdd, refresh }: FilesSectionProps) {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const refreshFiles = useRefreshFiles();
  const parentTrashed = card.deletedAt !== null;
  const deletedQuery = useDeletedFiles(parent, !parentTrashed);
  const refreshAll = () => Promise.all([refresh(), refreshFiles()]);
  const uploads = useUploads(parent, () => {
    void refreshAll();
    toast.show({ message: 'Файл добавлен' });
  });

  const live = card.files.filter((file) => file.deletedAt === null);
  // В карточке удалённой записи сервер отдаёт все файлы с отметками; в живой — только живые,
  // а отдельно удалённые приходят отдельным запросом вместе с правом на восстановление.
  const deleted: ListedFile[] = parentTrashed
    ? card.files.filter((file) => file.deletedAt !== null)
    : (deletedQuery.data ?? []);

  function choose(list: FileList | null) {
    if (list === null || list.length === 0) return;
    uploads.add([...list]);
  }

  return (
    <Section
      title="Файлы"
      aside={live.length > 0 ? <span className="muted">{fileCount(live.length)}</span> : undefined}
    >
      {canAdd && !parentTrashed ? (
        <>
          <input
            ref={picker}
            type="file"
            className="file-input"
            accept={FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              choose(event.currentTarget.files);
              // Тот же файл можно выбрать снова.
              event.currentTarget.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => picker.current?.click()}
          >
            <Plus size={20} aria-hidden />
            Добавить файл
          </button>
          <p className="field__hint file-hint">
            Фото (JPEG, PNG, WebP, HEIC) и PDF до 25 МБ. Файл увидят те же люди, что и запись.
          </p>
        </>
      ) : null}

      {uploads.items.length > 0 ? (
        <ul className="upload-list" aria-label="Загрузка файлов">
          {uploads.items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              onCancel={() => uploads.cancel(item.key)}
              onRetry={() => uploads.retry(item.key)}
            />
          ))}
        </ul>
      ) : null}

      {live.length === 0 && uploads.items.length === 0 ? (
        <EmptyState icon={<Files size={24} aria-hidden />} title="Файлов пока нет">
          <p>
            {canAdd && !parentTrashed
              ? 'Добавьте фото или PDF: квитанцию, договор, снимок счётчика.'
              : 'К этой записи ничего не прикреплено.'}
          </p>
          <p>Файлы видят только те люди, которые видят саму запись.</p>
        </EmptyState>
      ) : null}

      {live.length > 0 ? (
        <ul className="file-list" aria-label="Файлы записи">
          {live.map((file) => (
            <FileRow key={file.id} file={file} parent={parent} card={card} refresh={refreshAll} />
          ))}
        </ul>
      ) : null}

      {deletedQuery.isError && !parentTrashed ? (
        <>
          <Notice error>
            Не удалось загрузить удалённые файлы. Проверьте подключение и повторите.
          </Notice>
          <button className="text-button" type="button" onClick={() => void deletedQuery.refetch()}>
            Повторить загрузку удалённых файлов
          </button>
        </>
      ) : null}

      {deleted.length > 0 ? (
        <div className="file-trash">
          <h3 className="file-trash__title">Удалённые файлы</h3>
          <p className="muted">Хранятся 30 дней, потом исчезают навсегда.</p>
          <ul className="file-list" aria-label="Удалённые файлы">
            {deleted.map((file) => (
              <FileRow key={file.id} file={file} parent={parent} card={card} refresh={refreshAll} />
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
