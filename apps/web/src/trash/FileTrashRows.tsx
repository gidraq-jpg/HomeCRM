import {
  ArrowCounterClockwise,
  CalendarBlank,
  Camera,
  DownloadSimple,
  FilePdf,
  ImageSquare,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { restoreDeadline, type TrashedDeadline } from '../deadlines/api.ts';
import { DeadlineError } from '../deadlines/components.tsx';
import { describeRule } from '../deadlines/labels.ts';
import { useRefreshDeadlines } from '../deadlines/queries.ts';
import { fileUrl, restoreFile, restoreProfilePhoto, type TrashedFile } from '../files/api.ts';
import { fileErrorMessage } from '../files/errors.ts';
import { isPdf } from '../files/FilesSection.tsx';
import { useRefreshFiles } from '../files/queries.ts';
import { formatFileSize } from '../files/size.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useRefresh } from '../household/queries.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { todayIn } from '../objects/dates.ts';
import { Link } from '../ui/navigation.tsx';
import { RowContent } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { keepUntil, PARENT_LABELS, parentLinkLabel, parentPathOf } from './retention.ts';

export function FileTrashRow({ file }: { file: TrashedFile }) {
  const { me } = useHousehold();
  const refresh = useRefreshFiles();
  const refreshProfile = useRefresh();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const deletedAt = file.deletedAt ?? file.createdAt;
  const profile = file.parentType === 'profile';
  const parentPath = parentPathOf(file);

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={
            profile ? (
              <Camera size={22} aria-hidden />
            ) : isPdf(file) ? (
              <FilePdf size={22} aria-hidden />
            ) : (
              <ImageSquare size={22} aria-hidden />
            )
          }
          title={profile ? 'Фото профиля' : file.name}
          meta={`${PARENT_LABELS[file.parentType]} · ${formatFileSize(file.sizeBytes)} · удалён ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
        />
      </div>
      <div className="file-row__actions">
        {file.canRestore ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled || done}
            aria-label={`Восстановить файл: ${profile ? 'фото профиля' : file.name}`}
            onClick={() =>
              void state.run(async () => {
                if (profile) await restoreProfilePhoto(file.id);
                else
                  await restoreFile(
                    {
                      kind: file.parentType === 'profile' ? 'object' : file.parentType,
                      id: file.parentId,
                    },
                    file.id,
                  );
                setDone(true);
                await Promise.all([
                  refresh(),
                  ...(profile ? [refreshProfile.profile(), refreshProfile.members()] : []),
                ]);
                toast.show({
                  message: 'Файл возвращён',
                  detail: profile
                    ? 'Это фото снова ваше текущее фото профиля.'
                    : 'Он снова в карточке записи.',
                });
              })
            }
          >
            <ArrowCounterClockwise size={20} aria-hidden />
            {state.pending ? 'Возвращаем…' : 'Восстановить'}
          </button>
        ) : null}
        <a className="btn btn--secondary" href={fileUrl(file.id)} download>
          <DownloadSimple size={20} aria-hidden />
          Скачать
        </a>
        {parentPath === null ? null : (
          <Link className="btn btn--secondary" to={parentPath}>
            {parentLinkLabel(file.parentType)}
          </Link>
        )}
      </div>
      {file.canRestore ? null : (
        <p className="muted trash-item__note">
          Вернуть этот файл может его автор-взрослый или администратор.
        </p>
      )}
      {state.error ? <Notice error>{fileErrorMessage(state.error, 'restore')}</Notice> : null}
    </li>
  );
}

export function DeadlineTrashRow({ item }: { item: TrashedDeadline }) {
  const { me } = useHousehold();
  const refresh = useRefreshDeadlines();
  const state = useAction();
  const toast = useToast();
  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<CalendarBlank size={22} aria-hidden />}
          title={item.title}
          meta={`${describeRule(item.rule, todayIn(me.timeZone))} · удалён ${formatDay(item.deletedAt ?? item.updatedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(item.deletedAt ?? item.updatedAt), me.timeZone)}`}
          badge={visibilityOf(item)}
        />
      </div>
      {item.canRestore ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={state.disabled}
          onClick={() =>
            void state.run(async () => {
              await restoreDeadline(item.id);
              await refresh();
              toast.show({ message: 'Срок возвращён' });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить срок'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Сначала восстановите запись. Вернуть срок может его автор-взрослый или администратор.
        </p>
      )}
      <DeadlineError error={state.error} action="save" />
    </li>
  );
}
