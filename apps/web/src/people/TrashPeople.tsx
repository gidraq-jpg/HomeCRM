import { useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { formatDay } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { noteAbilities, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { Section } from '../ui/Page.tsx';
import { RowContent } from '../ui/Row.tsx';
import { useToast } from '../ui/Toast.tsx';
import { type Interaction, restoreInteraction, restorePerson } from './api.ts';
import { type useContactsList, useInteractions, useRefreshContacts } from './queries.ts';
import type { PersonCard } from './schema.ts';

function RestoreRow({
  item,
  type,
  restore,
  title,
  to,
}: {
  item: PersonCard | Interaction;
  type: 'contact' | 'contact_interaction';
  restore: () => Promise<unknown>;
  title: string;
  to?: string;
}) {
  const { me, householdId } = useHousehold();
  const refresh = useRefreshContacts();
  const toast = useToast();
  const state = useAction();
  const [done, setDone] = useState(false);
  const abilities = noteAbilities(viewerOf(me), item, householdId, type);
  if (done) return null;
  return (
    <li className="trash-item">
      <div className="row">
        <RowContent
          title={
            to ? (
              <Link className="text-button" to={to}>
                {title}
              </Link>
            ) : (
              title
            )
          }
          meta={`Удалено ${formatDay(item.deletedAt ?? item.updatedAt, me.timeZone)} · хранится 30 дней`}
          badge={visibilityOf(item)}
        />
      </div>
      {abilities.restore ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={state.disabled}
          onClick={() =>
            void state.run(async () => {
              await restore();
              setDone(true);
              await refresh();
              toast.show({ message: 'Запись возвращена' });
            })
          }
        >
          {state.pending ? 'Возвращаем…' : 'Восстановить'}
        </button>
      ) : (
        <p className="muted">Вернуть запись может её автор-взрослый или администратор.</p>
      )}
      <ObjectError error={state.error} action="restore" />
    </li>
  );
}

/** Люди — в общей корзине. Удалённые взаимодействия — в карточке своего контакта. */
export function TrashPeople({ query }: { query: ReturnType<typeof useContactsList> }) {
  const items = query.data?.pages.flat() ?? [];
  return (
    <Section title="Люди">
      {query.isPending ? <Notice>Загружаем удалённые контакты…</Notice> : null}
      {query.isError ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button type="button" className="text-button" onClick={() => void query.refetch()}>
            Повторить загрузку контактов из корзины
          </button>
        </>
      ) : null}
      {query.data && items.length === 0 ? <p className="muted">Удалённых людей нет.</p> : null}
      <ul className="trash-list" aria-label="Удалённые люди">
        {items.map((item) =>
          item.kind === 'person' ? (
            <RestoreRow
              key={item.id}
              item={item}
              type="contact"
              title={item.title}
              to={`/people/contacts/${item.id}`}
              restore={() => restorePerson(item.id)}
            />
          ) : null,
        )}
      </ul>
      {query.hasNextPage ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Показать ещё людей
        </button>
      ) : null}
      <p className="muted">
        Удалённые взаимодействия можно вернуть в карточке контакта. Контакт возвращается вместе с
        записями, удалёнными вместе с ним.
      </p>
    </Section>
  );
}

export function TrashInteractions({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const query = useInteractions(contactId, true, open);
  return (
    <div className="section">
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        Корзина взаимодействий
      </button>
      {open ? (
        <>
          {query.isPending ? <Notice>Загружаем удалённые взаимодействия…</Notice> : null}
          {query.isError ? (
            <>
              <ObjectError error={query.error} action="load" />
              <button type="button" className="text-button" onClick={() => void query.refetch()}>
                Повторить загрузку взаимодействий из корзины
              </button>
            </>
          ) : null}
          {query.data && query.data.pages.flat().length === 0 ? (
            <p className="muted">Удалённых взаимодействий нет.</p>
          ) : null}
          <ul className="trash-list" aria-label="Удалённые взаимодействия">
            {query.data?.pages.flat().map((item) => (
              <RestoreRow
                key={item.id}
                item={item}
                type="contact_interaction"
                title={item.text}
                restore={() => restoreInteraction(contactId, item.id)}
              />
            ))}
          </ul>
          {query.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              Показать ещё взаимодействия
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
