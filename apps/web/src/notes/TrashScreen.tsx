import {
  AddressBook,
  ArrowCounterClockwise,
  CalendarBlank,
  Camera,
  CreditCard,
  DownloadSimple,
  FilePdf,
  FileText,
  ImageSquare,
  Note,
  Trash,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope, SCOPE_LABELS } from '../access/scope.ts';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { restoreAccount } from '../accounts/api.ts';
import { ACCOUNT_TYPE, accountCount } from '../accounts/ObjectAccounts.tsx';
import {
  type TrashedAccount,
  useRefreshAccounts,
  useTrashedAccounts,
} from '../accounts/queries.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { restoreDeadline, type TrashedDeadline } from '../deadlines/api.ts';
import { DeadlineError } from '../deadlines/components.tsx';
import { describeRule } from '../deadlines/labels.ts';
import { useRefreshDeadlines, useTrashedDeadlines } from '../deadlines/queries.ts';
import { type DocumentCard, NO_FILTERS, restoreDocument } from '../documents/api.ts';
import { DocumentError } from '../documents/components.tsx';
import { DOCUMENT_LABELS, documentCount } from '../documents/labels.ts';
import { useDocumentsList, useRefreshDocuments } from '../documents/queries.ts';
import { fileUrl, restoreFile, restoreProfilePhoto, type TrashedFile } from '../files/api.ts';
import { fileErrorMessage } from '../files/errors.ts';
import { isPdf } from '../files/FilesSection.tsx';
import { useRefreshFiles, useTrashedFiles } from '../files/queries.ts';
import { formatFileSize } from '../files/size.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useRefresh } from '../household/queries.ts';
import { objectAbilities } from '../objects/abilities.ts';
import { type ObjectSummary, restoreObject } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { todayIn } from '../objects/dates.ts';
import { useObjectsList, useRefreshObjects } from '../objects/queries.ts';
import { OBJECT_TYPE_ICONS, objectCount } from '../objects/types.ts';
import { organizationAbilities } from '../organizations/abilities.ts';
import { type ContactCard, restoreOrganization } from '../organizations/api.ts';
import { ORGANIZATION_TYPE_LABELS } from '../organizations/form.ts';
import { organizationCount } from '../organizations/OrganizationsScreen.tsx';
import { useOrganizationsList, useRefreshOrganizations } from '../organizations/queries.ts';
import { useContactsList } from '../people/queries.ts';
import { TrashPeople } from '../people/TrashPeople.tsx';
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
      {object.objectType === 'property' ? (
        <p className="muted trash-item__note">Лицевые счета вернутся вместе с объектом.</p>
      ) : null}
      <ObjectError error={state.error} action="restore" />
    </li>
  );
}

function OrganizationTrashRow({ organization }: { organization: ContactCard }) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshOrganizations();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const abilities = organizationAbilities(viewerOf(me), organization, householdId);
  const visibility = visibilityOf(organization);
  const deletedAt = organization.deletedAt ?? organization.updatedAt;

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<AddressBook size={22} aria-hidden />}
          title={organization.title}
          meta={`${ORGANIZATION_TYPE_LABELS[organization.data.organizationType]} · ${VISIBILITY_LABELS[visibility]} · удалена ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
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
              await restoreOrganization(organization.id);
              setDone(true);
              await refresh();
              toast.show({
                message: 'Организация возвращена',
                detail: 'Она снова в списке «Организации».',
              });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Вернуть эту организацию может её автор-взрослый или администратор.
        </p>
      )}
      <ObjectError error={state.error} action="contact" />
    </li>
  );
}

function DocumentTrashRow({ document }: { document: DocumentCard }) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshDocuments();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const abilities = noteAbilities(viewerOf(me), document, householdId, 'document');
  const visibility = visibilityOf(document);
  const deletedAt = document.deletedAt ?? document.updatedAt;

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<FileText size={22} aria-hidden />}
          title={document.title}
          meta={`${DOCUMENT_LABELS[document.data.type]} · ${VISIBILITY_LABELS[visibility]} · удалён ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
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
              await restoreDocument(document.id);
              setDone(true);
              await refresh();
              toast.show({
                message: 'Документ возвращён',
                detail: 'Он снова в разделе «Документы», вместе со страницами.',
              });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Вернуть этот документ может его автор-взрослый или администратор.
        </p>
      )}
      <DocumentError error={state.error} action="restore" />
    </li>
  );
}
function AccountTrashRow({ item }: { item: TrashedAccount }) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshAccounts();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const { account } = item;
  const abilities = noteAbilities(viewerOf(me), account, householdId, ACCOUNT_TYPE);
  const visibility = visibilityOf(account);
  const deletedAt = account.deletedAt ?? account.updatedAt;

  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          icon={<CreditCard size={22} aria-hidden />}
          title={account.title}
          meta={`из объекта «${item.objectTitle}» · удалён ${formatDay(deletedAt, me.timeZone)}, хранится до ${formatDay(keepUntil(deletedAt), me.timeZone)}`}
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
              await restoreAccount(account.id);
              setDone(true);
              await refresh();
              toast.show({
                message: 'Лицевой счёт возвращён',
                detail: 'Он снова на вкладке «Счета» объекта.',
              });
            })
          }
        >
          <ArrowCounterClockwise size={20} aria-hidden />
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted trash-item__note">
          Вернуть этот лицевой счёт может его автор-взрослый или администратор.
        </p>
      )}
      <ObjectError error={state.error} action="account" />
    </li>
  );
}

const PARENT_LABELS = {
  note: 'из заметки',
  object: 'из объекта',
  document: 'из документа',
  profile: 'фото профиля',
} as const;

function FileTrashRow({ file }: { file: TrashedFile }) {
  const { me } = useHousehold();
  const refresh = useRefreshFiles();
  const refreshProfile = useRefresh();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const deletedAt = file.deletedAt ?? file.createdAt;
  const profile = file.parentType === 'profile';
  const parentPath =
    file.parentType === 'note'
      ? `/more/notes/${file.parentId}`
      : file.parentType === 'object'
        ? `/home/${file.parentId}/files`
        : file.parentType === 'document'
          ? `/documents/${file.parentId}`
          : null;

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
            {file.parentType === 'note'
              ? 'К заметке'
              : file.parentType === 'document'
                ? 'К документу'
                : 'К объекту'}
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

const fileCount = (count: number) => countWord(count, ['файл', 'файла', 'файлов']);
const recordCount = (count: number) => countWord(count, ['запись', 'записи', 'записей']);

function DeadlineTrashRow({ item }: { item: TrashedDeadline }) {
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

/**
 * «Корзина»: удалённые заметки, объекты и файлы хранятся 30 дней, восстановить можно по правилам
 * 7.3. У заметок, объектов и файлов свои загрузка и ошибка: сбой одного блока не ломает другие.
 */
export function TrashScreen() {
  const notesQuery = useNotesList(true);
  const objectsQuery = useObjectsList(true);
  const filesQuery = useTrashedFiles();
  const deadlinesQuery = useTrashedDeadlines();
  const organizationsQuery = useOrganizationsList(true, null);
  const accountsQuery = useTrashedAccounts();
  const documentsQuery = useDocumentsList({ ...NO_FILTERS, status: 'all' }, true);
  const peopleQuery = useContactsList({ kind: 'person', category: null, query: '' }, true);
  const { scope, setScope } = useScope();

  if (notesQuery.isPending || objectsQuery.isPending || filesQuery.isPending) {
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
  const files = filesQuery.data ?? [];
  const deadlines = (deadlinesQuery.data ?? []).filter((item) =>
    matchesScope(visibilityOf(item), scope),
  );
  const organizations = (organizationsQuery.data?.pages.flat() ?? []).filter((item) =>
    matchesScope(visibilityOf(item), scope),
  );
  const accounts = accountsQuery.data ?? [];
  const documents = documentsQuery.data?.pages.flat() ?? [];
  const total =
    notes.length +
    objects.length +
    files.length +
    deadlines.length +
    organizations.length +
    accounts.length +
    documents.length +
    (peopleQuery.data?.pages.flat().length ?? 0);
  const failed =
    notesQuery.data === undefined ||
    objectsQuery.data === undefined ||
    filesQuery.isError ||
    deadlinesQuery.isError ||
    deadlinesQuery.isPending ||
    organizationsQuery.isError ||
    organizationsQuery.isPending ||
    accountsQuery.isError ||
    accountsQuery.isPending ||
    documentsQuery.isError ||
    documentsQuery.isPending ||
    peopleQuery.isPending ||
    peopleQuery.isError;

  return (
    <Page title="Корзина" back={BACK} {...(total > 0 ? { eyebrow: recordCount(total) } : {})}>
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
        <EmptyState icon={<Trash size={24} aria-hidden />} title="В корзине пусто">
          <p>
            Удалённые заметки, объекты, документы и файлы хранятся здесь 30 дней, потом исчезают
            навсегда. Пока ничего не удалено.
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
