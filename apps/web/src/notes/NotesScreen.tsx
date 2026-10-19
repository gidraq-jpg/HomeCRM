import { Note, PushPin } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { AddAction } from '../shell/AddAction.tsx';
import { EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { countWord, normalizeText } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { visibilityOf } from './abilities.ts';
import type { NoteSummary } from './api.ts';
import { NoteError } from './components.tsx';
import { useNotesList } from './queries.ts';
import '../styles/studio2-lists.css';

const BACK = { to: '/more', label: 'Ещё' } as const;
export const noteCount = (count: number) => countWord(count, ['заметка', 'заметки', 'заметок']);

export function NoteRows({ notes, label }: { notes: readonly NoteSummary[]; label: string }) {
  const { me } = useHousehold();
  return (
    <RowList label={label}>
      {notes.map((note) => (
        <Row
          key={note.id}
          to={`/more/notes/${note.id}`}
          icon={note.pinned ? <PushPin size={22} aria-hidden /> : <Note size={22} aria-hidden />}
          title={note.title}
          meta={`${formatDay(note.updatedAt, me.timeZone)} · ${VISIBILITY_LABELS[visibilityOf(note)]}`}
        />
      ))}
    </RowList>
  );
}

/** Список не запрашивает карточки ради текста, прогресса, файлов и связей макета. */
export function NotesScreen() {
  const { scope } = useScope();
  const query = useNotesList(false);
  const [filter, setFilter] = useState('');
  const fieldId = useId();
  const all = query.data?.pages.flat() ?? [];
  const needle = normalizeText(filter.trim());
  const shown = all.filter((note) => normalizeText(note.title).includes(needle));
  const pinned = shown.filter((note) => note.pinned);
  const recent = shown
    .filter((note) => !note.pinned)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Page
      title="Заметки"
      back={BACK}
      className="studio-list-page notes-page"
      heading={
        <div className="studio-list-hero">
          <div className="page-heading__line">
            <h1 aria-label="Заметки">
              Заметки
              {query.data ? (
                <span
                  className="studio-list-count"
                  role="status"
                  aria-label={`${query.hasNextPage ? 'Не менее ' : ''}${noteCount(all.length)}`}
                >
                  {' '}
                  · {all.length}
                  {query.hasNextPage ? '+' : ''}
                </span>
              ) : null}
            </h1>
            <AddAction />
          </div>
        </div>
      }
    >
      <div className="studio-panel studio-list-panel">
        {query.isPending ? <Notice>Загружаем заметки…</Notice> : null}
        {query.isError ? (
          <>
            <NoteError error={query.error} action="load" />
            <button className="text-button" type="button" onClick={() => void query.refetch()}>
              Повторить загрузку заметок
            </button>
          </>
        ) : null}
        {all.length ? (
          <div className="field search-field">
            <label className="field__label" htmlFor={fieldId}>
              Найти по заголовку
            </label>
            <input
              id={fieldId}
              className="input"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </div>
        ) : null}
        {query.data && !shown.length ? (
          all.length ? (
            <p className="muted">Ничего не нашли среди загруженных заметок.</p>
          ) : (
            <section aria-label="Заметок пока нет">
              <p className="muted">
                <span>Заметок пока нет</span>.{' '}
                {scope === 'all'
                  ? 'Личное видно только вам, общее — семье.'
                  : EMPTY_SCOPE_EXPLANATION[scope]}
              </p>
            </section>
          )
        ) : null}
        {pinned.length ? (
          <Section title="Закреплённые">
            <ul className="notes-pinned" aria-label="Закреплённые заметки">
              {pinned.map((note) => (
                <li key={note.id} className="notes-pinned__item">
                  <Link className="notes-pinned__card" to={`/more/notes/${note.id}`}>
                    <span className="notes-pinned__title">{note.title}</span>
                    <span className="notes-pinned__meta">
                      {VISIBILITY_LABELS[visibilityOf(note)]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {recent.length ? (
          <Section title="Недавние">
            <NoteRows notes={recent} label="Недавние заметки" />
          </Section>
        ) : null}
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
      </div>
    </Page>
  );
}
