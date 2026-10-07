import { ArrowCounterClockwise, Note, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { objectAbilities } from '../objects/abilities.ts';
import { type ObjectSummary, restoreObject } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { useObjectsList, useRefreshObjects } from '../objects/queries.ts';
import { OBJECT_TYPE_ICONS, objectCount } from '../objects/types.ts';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { RowContent } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { noteAbilities, viewerOf, visibilityOf } from './abilities.ts';
import { type NoteSummary, restoreNote } from './api.ts';
import { NoteError } from './components.tsx';
import { noteCount } from './NotesScreen.tsx';
import { useNotesList, useRefreshNotes } from './queries.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;
/** Корзина хранит удалённое 30 дней (DATA-1). Дату удаления ставит база. */
const RETENTION_DAYS = 30;

function keepUntil(deletedAt: string): Date {
  return new Date(new Date(deletedAt).getTime() + RETENTION_DAYS * 86_400_000);
}

function TrashRow({ note }: { note: NoteSummary }) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshNotes();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const abilities = noteAbilities(viewerOf(me), note, householdId);
  const visibility = visibilityOf(note);
  const deletedAt = note.deletedAt ?? note.updatedAt;

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<Note size={22} aria-hidden />}
          title={note.title}
          meta={`${VISIBILITY_LABELS[visibility]} · удалена ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
          badge={visibility}
        />
      </div>
      {abilities.restore ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={state.disabled || done}
          onClick={() =>
            void state.run(async () => {
              await restoreNote(note.id);
              setDone(true);
              await refresh();
              toast.show({
                message: 'Заметка возвращена',
                detail: 'Она снова в списке «Заметки».',
              });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Вернуть эту заметку может её автор-взрослый или администратор.
        </p>
      )}
      <NoteError error={state.error} action="restore" />
    </li>
  );
}

function ObjectTrashRow({ object }: { object: ObjectSummary }) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshObjects();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const abilities = objectAbilities(viewerOf(me), object, householdId);
  const visibility = visibilityOf(object);
  const deletedAt = object.deletedAt ?? object.updatedAt;
  const TypeIcon = OBJECT_TYPE_ICONS[object.objectType];

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<TypeIcon size={22} aria-hidden />}
          title={object.title}
          meta={`${VISIBILITY_LABELS[visibility]} · удалён ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
          badge={visibility}
        />
      </div>
      {abilities.restore ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={state.disabled || done}
          onClick={() =>
            void state.run(async () => {
              await restoreObject(object.id);
              setDone(true);
              await refresh();
              toast.show({
                message: 'Объект возвращён',
                detail: 'Он снова в разделе «Дом», вместе с полями и событиями ленты.',
              });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Вернуть этот объект может его автор-взрослый или администратор.
        </p>
      )}
      <ObjectError error={state.error} action="restore" />
    </li>
  );
}

const recordCount = (count: number) => countWord(count, ['запись', 'записи', 'записей']);

/**
 * «Корзина»: удалённые заметки и объекты хранятся 30 дней, восстановить можно по правилам 7.3.
 * У заметок и объектов свои загрузка и ошибка: сбой одного блока не ломает второй.
 */
export function TrashScreen() {
  const notesQuery = useNotesList(true);
  const objectsQuery = useObjectsList(true);
  const { scope, setScope } = useScope();

  if (notesQuery.isPending || objectsQuery.isPending) {
    return (
      <Page title="Корзина" back={BACK}>
        <Notice>Загружаем корзину…</Notice>
      </Page>
    );
  }
  if (notesQuery.data === undefined && objectsQuery.data === undefined) {
    return (
      <Page title="Корзина" back={BACK}>
        <NoteError error={notesQuery.error} action="load" />
        <button
          className="text-button"
          type="button"
          onClick={() => {
            void notesQuery.refetch();
            void objectsQuery.refetch();
          }}
        >
          Повторить загрузку корзины
        </button>
      </Page>
    );
  }
  const notes = notesQuery.data?.pages.flat() ?? [];
  const objects = objectsQuery.data?.pages.flat() ?? [];
  const total = notes.length + objects.length;
  const failed = notesQuery.data === undefined || objectsQuery.data === undefined;

  return (
    <Page title="Корзина" back={BACK} {...(total > 0 ? { eyebrow: recordCount(total) } : {})}>
      {notesQuery.data === undefined ? (
        <>
          <NoteError error={notesQuery.error} action="load" />
          <button className="text-button" type="button" onClick={() => void notesQuery.refetch()}>
            Повторить загрузку заметок из корзины
          </button>
        </>
      ) : null}
      {objectsQuery.data === undefined ? (
        <>
          <ObjectError error={objectsQuery.error} action="load" />
          <button className="text-button" type="button" onClick={() => void objectsQuery.refetch()}>
            Повторить загрузку объектов из корзины
          </button>
        </>
      ) : null}

      {total === 0 && !failed ? (
        <EmptyState icon={<Trash size={24} aria-hidden />} title="В корзине пусто">
          <p>
            Удалённые заметки и объекты хранятся здесь 30 дней, потом исчезают навсегда. Пока ничего
            не удалено.
          </p>
          <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
          {scope === 'all' ? null : (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setScope('all')}
            >
              Показать «{SCOPE_LABELS.all}»
            </button>
          )}
        </EmptyState>
      ) : null}

      {total > 0 ? (
        <p className="muted trash-lead">
          Удалённое хранится {RETENTION_DAYS} дней, потом исчезает навсегда. Менять его нельзя,
          можно только вернуть.
        </p>
      ) : null}

      {notes.length > 0 ? (
        <Section title="Заметки" aside={<span className="muted">{noteCount(notes.length)}</span>}>
          <ul className="trash-list" aria-label="Удалённые заметки">
            {notes.map((note) => (
              <TrashRow key={note.id} note={note} />
            ))}
          </ul>
          {notesQuery.isError ? <NoteError error={notesQuery.error} action="load" /> : null}
          {notesQuery.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={notesQuery.isFetchingNextPage}
              onClick={() => void notesQuery.fetchNextPage()}
            >
              {notesQuery.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё заметки'}
            </button>
          ) : null}
        </Section>
      ) : null}

      {objects.length > 0 ? (
        <Section
          title="Объекты"
          aside={<span className="muted">{objectCount(objects.length)}</span>}
        >
          <ul className="trash-list" aria-label="Удалённые объекты">
            {objects.map((object) => (
              <ObjectTrashRow key={object.id} object={object} />
            ))}
          </ul>
          {objectsQuery.isError ? <ObjectError error={objectsQuery.error} action="load" /> : null}
          {objectsQuery.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={objectsQuery.isFetchingNextPage}
              onClick={() => void objectsQuery.fetchNextPage()}
            >
              {objectsQuery.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё объекты'}
            </button>
          ) : null}
        </Section>
      ) : null}
    </Page>
  );
}
