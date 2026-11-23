import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { accountCount } from '../accounts/ObjectAccounts.tsx';
import { Notice } from '../auth/components.tsx';
import { DeadlineError } from '../deadlines/components.tsx';
import { DocumentError } from '../documents/components.tsx';
import { documentCount } from '../documents/labels.ts';
import { NoteError } from '../notes/components.tsx';
import { noteCount } from '../notes/NotesScreen.tsx';
import { ObjectError } from '../objects/components.tsx';
import { objectCount } from '../objects/types.ts';
import { organizationCount } from '../organizations/OrganizationsScreen.tsx';
import { TrashPeople } from '../people/TrashPeople.tsx';
import { TrashTasks } from '../tasks/TrashTasks.tsx';
import { CompactEmptyState, EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { Section } from '../ui/Page.tsx';
import { StudioPage as Page } from '../ui/StudioPage.tsx';
import { DeadlineTrashRow, FileTrashRow } from './FileTrashRows.tsx';
import {
  AccountTrashRow,
  DocumentTrashRow,
  NoteTrashRow,
  ObjectTrashRow,
  OrganizationTrashRow,
} from './RecordTrashRows.tsx';
import { fileCount, RETENTION_DAYS, recordCount } from './retention.ts';
import { useTrashContents, useTrashQueries } from './useTrash.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;

/**
 * «Корзина»: удалённые заметки, объекты и файлы хранятся 30 дней, восстановить можно по правилам
 * 7.3. У заметок, объектов и файлов свои загрузка и ошибка: сбой одного блока не ломает другие.
 */
export function TrashScreen() {
  const queries = useTrashQueries();
  const {
    notesQuery,
    objectsQuery,
    filesQuery,
    deadlinesQuery,
    organizationsQuery,
    accountsQuery,
    documentsQuery,
    peopleQuery,
  } = queries;
  const { scope, setScope } = useScope();
  const { notes, objects, files, deadlines, organizations, accounts, documents, total, failed } =
    useTrashContents(queries);

  if (notesQuery.isPending || objectsQuery.isPending || filesQuery.isPending) {
    return (
      <Page service title="Корзина" back={BACK}>
        <Notice>Загружаем корзину…</Notice>
      </Page>
    );
  }
  if (notesQuery.data === undefined && objectsQuery.data === undefined) {
    return (
      <Page service title="Корзина" back={BACK}>
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

  return (
    <Page
      service
      title="Корзина"
      back={BACK}
      {...(total > 0 ? { eyebrow: recordCount(total) } : {})}
    >
      <TrashTasks />
      <TrashPeople query={peopleQuery} />
      {deadlinesQuery.isPending ? <Notice>Загружаем удалённые сроки…</Notice> : null}
      {deadlinesQuery.isError ? (
        <>
          <DeadlineError error={deadlinesQuery.error} action="load" />
          <button
            type="button"
            className="text-button"
            onClick={() => void deadlinesQuery.refetch()}
          >
            Повторить загрузку сроков из корзины
          </button>
        </>
      ) : null}
      {deadlines.length > 0 ? (
        <Section title="Сроки">
          <ul className="trash-list" aria-label="Удалённые сроки">
            {deadlines.map((item) => (
              <DeadlineTrashRow key={item.id} item={item} />
            ))}
          </ul>
        </Section>
      ) : null}
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

      {filesQuery.isError ? (
        <>
          <Notice error>
            Не удалось загрузить удалённые файлы. Проверьте подключение и повторите.
          </Notice>
          <button className="text-button" type="button" onClick={() => void filesQuery.refetch()}>
            Повторить загрузку файлов из корзины
          </button>
        </>
      ) : null}

      {total === 0 && !failed ? (
        <CompactEmptyState title="В корзине пусто">
          {scope !== 'all' ? <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p> : null}
          {scope === 'all' ? null : (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              onClick={() => setScope('all')}
            >
              Показать «{SCOPE_LABELS.all}»
            </button>
          )}
        </CompactEmptyState>
      ) : null}

      {!failed ? (
        <p className="muted trash-lead">
          Удалённые заметки, объекты, документы и файлы хранятся здесь {RETENTION_DAYS} дней, потом
          исчезают навсегда. Менять их нельзя, можно только вернуть.
        </p>
      ) : null}

      {notes.length > 0 ? (
        <Section title="Заметки" aside={<span className="muted">{noteCount(notes.length)}</span>}>
          <ul className="trash-list" aria-label="Удалённые заметки">
            {notes.map((note) => (
              <NoteTrashRow key={note.id} note={note} />
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

      {organizationsQuery.isError ? (
        <>
          <ObjectError error={organizationsQuery.error} action="load" />
          <button
            className="text-button"
            type="button"
            onClick={() => void organizationsQuery.refetch()}
          >
            Повторить загрузку организаций из корзины
          </button>
        </>
      ) : null}
      {organizations.length > 0 ? (
        <Section
          title="Организации"
          aside={<span className="muted">{organizationCount(organizations.length)}</span>}
        >
          <ul className="trash-list" aria-label="Удалённые организации">
            {organizations.map((organization) => (
              <OrganizationTrashRow key={organization.id} organization={organization} />
            ))}
          </ul>
          {organizationsQuery.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={organizationsQuery.isFetchingNextPage}
              onClick={() => void organizationsQuery.fetchNextPage()}
            >
              {organizationsQuery.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё организации'}
            </button>
          ) : null}
        </Section>
      ) : null}

      {accountsQuery.isError ? (
        <>
          <ObjectError error={accountsQuery.error} action="account" />
          <button
            className="text-button"
            type="button"
            onClick={() => void accountsQuery.refetch()}
          >
            Повторить загрузку лицевых счетов из корзины
          </button>
        </>
      ) : null}
      {accounts.length > 0 ? (
        <Section
          title="Лицевые счета"
          aside={<span className="muted">{accountCount(accounts.length)}</span>}
        >
          <ul className="trash-list" aria-label="Удалённые лицевые счета">
            {accounts.map((item) => (
              <AccountTrashRow key={item.account.id} item={item} />
            ))}
          </ul>
        </Section>
      ) : null}

      {documentsQuery.isError ? (
        <>
          <DocumentError error={documentsQuery.error} action="load" />
          <button
            className="text-button"
            type="button"
            onClick={() => void documentsQuery.refetch()}
          >
            Повторить загрузку документов из корзины
          </button>
        </>
      ) : null}
      {documents.length > 0 ? (
        <Section
          title="Документы"
          aside={<span className="muted">{documentCount(documents.length)}</span>}
        >
          <ul className="trash-list" aria-label="Удалённые документы">
            {documents.map((document) => (
              <DocumentTrashRow key={document.id} document={document} />
            ))}
          </ul>
          {documentsQuery.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={documentsQuery.isFetchingNextPage}
              onClick={() => void documentsQuery.fetchNextPage()}
            >
              {documentsQuery.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё документы'}
            </button>
          ) : null}
        </Section>
      ) : null}
      {files.length > 0 ? (
        <Section title="Файлы" aside={<span className="muted">{fileCount(files.length)}</span>}>
          <ul className="trash-list" aria-label="Удалённые файлы">
            {files.map((file) => (
              <FileTrashRow key={file.id} file={file} />
            ))}
          </ul>
        </Section>
      ) : null}
    </Page>
  );
}
