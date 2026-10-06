import { Note, Plus, PushPin } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { countWord, normalizeText } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { visibilityOf } from './abilities.ts';
import type { NoteSummary } from './api.ts';
import { NoteError } from './components.tsx';
import { useNotesList } from './queries.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;
const NEW_NOTE = '/more/notes/new';

/** Сколько заметок по-русски: «1 заметка», «2 заметки», «5 заметок». */
export const noteCount = (count: number) => countWord(count, ['заметка', 'заметки', 'заметок']);

export function NoteRows({ notes, label }: { notes: readonly NoteSummary[]; label: string }) {
  const { me } = useHousehold();
  return (
    <RowList label={label}>
      {notes.map((note) => {
        const visibility = visibilityOf(note);
        return (
          <Row
            key={note.id}
            to={`/more/notes/${note.id}`}
            icon={note.pinned ? <PushPin size={22} aria-hidden /> : <Note size={22} aria-hidden />}
            title={note.title}
            meta={`${VISIBILITY_LABELS[visibility]} · ${formatDay(note.updatedAt, me.timeZone)}`}
            badge={visibility}
          />
        );
      })}
    </RowList>
  );
}

/** Объяснение разницы личного и общего в пустом разделе — PRD 7.4 и TPL-4. */
function EmptyNotes() {
  const { scope, setScope } = useScope();
  return (
    <EmptyState
      icon={<Note size={24} aria-hidden />}
      title="Заметок пока нет"
      actions={
        <>
          <Link className="btn btn--primary btn--block" to={NEW_NOTE}>
            <Plus size={20} weight="bold" aria-hidden />
            Записать заметку
          </Link>
          {scope === 'all' ? null : (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setScope('all')}
            >
              Показать «{SCOPE_LABELS.all}»
            </button>
          )}
        </>
      }
    >
      <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
      <p>
        Личную заметку видите только вы. Общую видят все в доме или только взрослые. Чтобы
        поделиться личной заметкой, откройте её и выберите «Поделиться…».
      </p>
    </EmptyState>
  );
}

/** «Заметки» (NOTE-1…3): список под переключателем «Всё · Общее · Личное», закреплённые сверху. */
export function NotesScreen() {
  const query = useNotesList(false);
  const [filter, setFilter] = useState('');
  const fieldId = useId();

  if (query.isPending) {
    return (
      <Page title="Заметки" back={BACK}>
        <Notice>Загружаем заметки…</Notice>
      </Page>
    );
  }
  if (query.data === undefined) {
    return (
      <Page title="Заметки" back={BACK}>
        <NoteError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку заметок
        </button>
      </Page>
    );
  }

  const all = query.data.pages.flat();
  // Полноценный поиск — R0.6; здесь только отбор по заголовку среди загруженных заметок.
  const needle = normalizeText(filter.trim());
  const shown =
    needle === '' ? all : all.filter((note) => normalizeText(note.title).includes(needle));
  const pinned = shown.filter((note) => note.pinned);
  const rest = shown.filter((note) => !note.pinned);

  return (
    <Page
      title="Заметки"
      back={BACK}
      {...(all.length > 0 ? { eyebrow: noteCount(all.length) } : {})}
    >
      {all.length === 0 ? (
        <EmptyNotes />
      ) : (
        <>
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

          {shown.length === 0 ? (
            <EmptyState title="Ничего не нашли">
              <p>Заметок с таким словом в заголовке нет среди загруженных.</p>
              {query.hasNextPage ? (
                <p>Нажмите «Показать ещё»: часть заметок ещё не загружена.</p>
              ) : null}
            </EmptyState>
          ) : (
            <>
              {pinned.length > 0 ? (
                <Section
                  title="Закреплённые"
                  aside={<span className="muted">{pinned.length}</span>}
                >
                  <NoteRows notes={pinned} label="Закреплённые заметки" />
                </Section>
              ) : null}
              {rest.length > 0 ? (
                <Section
                  title={pinned.length > 0 ? 'Остальные' : 'Все заметки'}
                  aside={<span className="muted">{rest.length}</span>}
                >
                  <NoteRows notes={rest} label="Заметки" />
                </Section>
              ) : null}
            </>
          )}

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
          {query.isError ? <NoteError error={query.error} action="load" /> : null}

          <Link className="btn btn--primary btn--block list-action" to={NEW_NOTE}>
            <Plus size={20} weight="bold" aria-hidden />
            Записать заметку
          </Link>
        </>
      )}
    </Page>
  );
}
