import { Note, Plus } from '@phosphor-icons/react';
import { Link, useParams } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { countWord, formatShortDate } from '../../ui/format.ts';
import { Page } from '../../ui/Page.tsx';
import { Row, RowList } from '../../ui/Row.tsx';
import { AccessActions } from '../AccessActions.tsx';
import { useAddRequest } from '../add-request.tsx';
import { NotFoundScreen, ScopeEmpty } from '../components.tsx';
import { TODAY } from '../data/index.ts';
import { useAllRecords, useRecord, useRecords } from '../store.tsx';

/** «Заметки»: личные по умолчанию, в карточке общего объекта — как у объекта (NOTE-1…3). */
export function NotesScreen() {
  const notes = useRecords('note');
  const requestAdd = useAddRequest();
  const sorted = [...notes].sort((a, b) => b.created.localeCompare(a.created));

  return (
    <Page
      title="Заметки"
      back={{ to: '/more', label: 'Ещё' }}
      {...(notes.length > 0
        ? { eyebrow: countWord(notes.length, ['заметка', 'заметки', 'заметок']) }
        : {})}
    >
      {notes.length === 0 ? (
        <ScopeEmpty title="Заметок пока нет" addKind="note" addLabel="Записать заметку">
          Заметка по умолчанию личная. Чтобы поделиться ею, откройте её и выберите «Поделиться…».
        </ScopeEmpty>
      ) : (
        <>
          <RowList label="Заметки">
            {sorted.map((note) => (
              <Row
                key={note.id}
                to={`/more/notes/${note.id}`}
                icon={<Note size={22} aria-hidden />}
                title={note.title}
                meta={`${formatShortDate(note.created, TODAY)}${note.text ? ` · ${note.text}` : ''}`}
                badge={note.visibility}
              />
            ))}
          </RowList>
          <button
            type="button"
            className="btn btn--secondary btn--block list-action"
            onClick={() => requestAdd('note')}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Записать заметку
          </button>
        </>
      )}
    </Page>
  );
}

export function NoteScreen() {
  const { noteId } = useParams();
  const note = useRecord('note', noteId);
  const properties = useAllRecords('property');
  if (note === undefined) return <NotFoundScreen what="Заметка не найдена" />;
  const property = properties.find((item) => item.id === note.propertyId);

  return (
    <Page
      title={note.title}
      eyebrow={formatShortDate(note.created, TODAY)}
      back={{ to: '/more/notes', label: 'Заметки' }}
    >
      <p className="property-meta">
        <AccessBadge visibility={note.visibility} showLabel />
      </p>
      {note.text ? <p className="note-text">{note.text}</p> : <p className="muted">Текста нет.</p>}
      {property ? (
        <p className="muted">
          Связана с объектом: <Link to={`/home/${property.id}`}>{property.title}</Link>
        </p>
      ) : null}
      <AccessActions id={note.id} visibility={note.visibility} what="заметку" />
    </Page>
  );
}
