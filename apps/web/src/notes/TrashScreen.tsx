import { ArrowCounterClockwise, Note, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
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

/** «Корзина» заметок: удалённое хранится 30 дней, восстановить можно по правилам 7.3. */
export function TrashScreen() {
  const query = useNotesList(true);
  const { scope, setScope } = useScope();

  if (query.isPending) {
    return (
      <Page title="Корзина" back={BACK}>
        <Notice>Загружаем корзину…</Notice>
      </Page>
    );
  }
  if (query.data === undefined) {
    return (
      <Page title="Корзина" back={BACK}>
        <NoteError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку корзины
        </button>
      </Page>
    );
  }
  const notes = query.data.pages.flat();

  return (
    <Page
      title="Корзина"
      back={BACK}
      {...(notes.length > 0 ? { eyebrow: noteCount(notes.length) } : {})}
    >
      {notes.length === 0 ? (
        <EmptyState icon={<Trash size={24} aria-hidden />} title="В корзине пусто">
          <p>
            Удалённые заметки хранятся здесь 30 дней, потом исчезают навсегда. Пока ничего не
            удалено.
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
      ) : (
        <>
          <p className="muted trash-lead">
            Удалённые заметки хранятся {RETENTION_DAYS} дней, потом исчезают навсегда. Менять их
            нельзя, можно только вернуть.
          </p>
          <ul className="trash-list" aria-label="Удалённые заметки">
            {notes.map((note) => (
              <TrashRow key={note.id} note={note} />
            ))}
          </ul>
          {query.isError ? <NoteError error={query.error} action="load" /> : null}
          {query.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
            </button>
          ) : null}
        </>
      )}
    </Page>
  );
}
