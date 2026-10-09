import { AddressBook, Plus, User } from '@phosphor-icons/react';
import { useDeferredValue, useId, useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { viewerOf, visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { creatableOrganizationVisibilities } from '../organizations/abilities.ts';
import { useCanCreateOrganization } from '../organizations/CreateOrganization.tsx';
import { ORGANIZATION_TYPE_LABELS } from '../organizations/form.ts';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';
import type { ContactFilters, PersonCategory } from './api.ts';
import { CATEGORY_FILTER_LABELS, categoriesLabel, contactCount } from './labels.ts';
import { useContactsList } from './queries.ts';
import type { AnyContact } from './schema.ts';

export const NEW_PERSON = '/people/contacts/new';
export const NEW_ORGANIZATION_FROM_PEOPLE = '/more/organizations/new';

type Choice = 'all' | 'organizations' | PersonCategory;

const CHOICES: readonly { value: Choice; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'organizations', label: 'Организации' },
  ...(Object.keys(CATEGORY_FILTER_LABELS) as PersonCategory[]).map((value) => ({
    value,
    label: CATEGORY_FILTER_LABELS[value],
  })),
];

function filtersOf(choice: Choice, query: string): Omit<ContactFilters, 'scope'> {
  return {
    kind: choice === 'organizations' ? 'organization' : null,
    category: choice === 'all' || choice === 'organizations' ? null : choice,
    query,
  };
}

function ContactRow({ contact }: { contact: AnyContact }) {
  const visibility = visibilityOf(contact);
  if (contact.kind === 'organization') {
    const emergency = contact.data.phones.some((phone) => phone.emergency);
    return (
      <Row
        to={`/people/contacts/${contact.id}`}
        icon={<AddressBook size={22} aria-hidden />}
        title={
          <>
            {contact.title}
            {emergency ? (
              <span className="row__status">
                <Status tone="danger">Есть аварийный телефон</Status>
              </span>
            ) : null}
          </>
        }
        meta={`Организация · ${ORGANIZATION_TYPE_LABELS[contact.data.organizationType]}`}
        badge={visibility}
      />
    );
  }
  const categories = categoriesLabel(contact.data.categories);
  const meta = [categories === '' ? 'Человек' : categories, contact.organization?.title]
    .filter(Boolean)
    .join(' · ');
  return (
    <Row
      to={`/people/contacts/${contact.id}`}
      icon={<User size={22} aria-hidden />}
      title={contact.title}
      meta={meta}
      badge={visibility}
    />
  );
}

/**
 * «Контакты» в разделе «Люди» (CONT-1, CONT-2): люди и организации с поиском по ФИО и названию и
 * фильтром по категории. Поиск и фильтр живут в состоянии экрана и не попадают в адрес страницы.
 */
export function ContactsList() {
  const { me, householdId } = useHousehold();
  const { scope, setScope } = useScope();
  const [choice, setChoice] = useState<Choice>('all');
  const [text, setText] = useState('');
  const deferred = useDeferredValue(text);
  const query = useContactsList(filtersOf(choice, deferred));
  const canCreateOrganization = useCanCreateOrganization();
  const canCreatePerson =
    creatableOrganizationVisibilities(viewerOf(me), householdId, me.personalSpaceId).length > 0;
  const searchId = useId();

  const items = query.data?.pages.flat() ?? [];
  const searching = deferred.trim() !== '' || choice !== 'all';

  const add = (
    <div className="btn-row">
      {canCreatePerson ? (
        <Link className="btn btn--primary" to={NEW_PERSON}>
          <Plus size={20} weight="bold" aria-hidden />
          Добавить человека
        </Link>
      ) : null}
      {canCreateOrganization ? (
        <Link className="btn btn--secondary" to={NEW_ORGANIZATION_FROM_PEOPLE}>
          <Plus size={20} weight="bold" aria-hidden />
          Добавить организацию
        </Link>
      ) : null}
    </div>
  );

  return (
    <section className="section" aria-labelledby={`${searchId}-title`}>
      <div className="section__head">
        <h2 className="section__title" id={`${searchId}-title`}>
          Контакты
        </h2>
        {items.length > 0 ? <span className="muted">{contactCount(items.length)}</span> : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={searchId}>
          Поиск по ФИО и названию
        </label>
        <input
          id={searchId}
          className="input"
          type="search"
          value={text}
          maxLength={200}
          autoComplete="off"
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <ChipGroup
        legend="Категория контакта"
        value={choice}
        options={CHOICES}
        onChange={setChoice}
      />

      {query.isPending ? <Notice>Загружаем контакты…</Notice> : null}
      {query.isError && items.length === 0 ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку контактов
          </button>
        </>
      ) : null}

      {query.data && items.length === 0 ? (
        <EmptyState
          icon={<AddressBook size={24} aria-hidden />}
          title={searching ? 'Ничего не нашлось' : 'Контактов пока нет'}
          actions={
            <>
              {searching ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={() => {
                    setText('');
                    setChoice('all');
                  }}
                >
                  Сбросить поиск и фильтр
                </button>
              ) : (
                add
              )}
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
          {searching ? null : (
            <p>
              Здесь мастера, врачи, соседи и организации: телефон под рукой, звонок в одно касание.
              Личные контакты видите только вы, а мастеров по умолчанию видит вся семья.
            </p>
          )}
        </EmptyState>
      ) : null}

      {items.length > 0 ? (
        <>
          <RowList label="Контакты">
            {items.map((contact) => (
              <ContactRow key={contact.id} contact={contact} />
            ))}
          </RowList>
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
          {query.isError ? <ObjectError error={query.error} action="load" /> : null}
          {add}
        </>
      ) : null}
    </section>
  );
}
