import {
  AddressBook,
  ArrowCounterClockwise,
  CreditCard,
  FileText,
  Note,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { VISIBILITY_LABELS } from '../access/visibility.ts';
import { restoreAccount } from '../accounts/api.ts';
import { ACCOUNT_TYPE } from '../accounts/ObjectAccounts.tsx';
import { type TrashedAccount, useRefreshAccounts } from '../accounts/queries.ts';
import { useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { type DocumentCard, restoreDocument } from '../documents/api.ts';
import { DocumentError } from '../documents/components.tsx';
import { DOCUMENT_LABELS } from '../documents/labels.ts';
import { useRefreshDocuments } from '../documents/queries.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { noteAbilities, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { type NoteSummary, restoreNote } from '../notes/api.ts';
import { NoteError } from '../notes/components.tsx';
import { useRefreshNotes } from '../notes/queries.ts';
import { objectAbilities } from '../objects/abilities.ts';
import { type ObjectSummary, restoreObject } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { useRefreshObjects } from '../objects/queries.ts';
import { OBJECT_TYPE_ICONS } from '../objects/types.ts';
import { organizationAbilities } from '../organizations/abilities.ts';
import { type ContactCard, restoreOrganization } from '../organizations/api.ts';
import { ORGANIZATION_TYPE_LABELS } from '../organizations/form.ts';
import { useRefreshOrganizations } from '../organizations/queries.ts';
import { RowContent } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { keepUntil } from './retention.ts';

export function NoteTrashRow({ note }: { note: NoteSummary }) {
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

export function ObjectTrashRow({ object }: { object: ObjectSummary }) {
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

export function OrganizationTrashRow({ organization }: { organization: ContactCard }) {
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

export function DocumentTrashRow({ document }: { document: DocumentCard }) {
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

export function AccountTrashRow({ item }: { item: TrashedAccount }) {
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
