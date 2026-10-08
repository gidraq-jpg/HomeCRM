import { AddressBook, Plus } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { matchesScope, SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { Page } from '../ui/Page.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';
import type { ContactCard, OrganizationType } from './api.ts';
import { useCanCreateOrganization } from './CreateOrganization.tsx';
import { ORGANIZATION_TYPE_LABELS } from './form.ts';
import { useOrganizationsList } from './queries.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;
export const NEW_ORGANIZATION = '/more/organizations/new';

/** Сколько организаций по-русски: «1 организация», «2 организации», «5 организаций». */
export const organizationCount = (count: number) =>
  countWord(count, ['организация', 'организации', 'организаций']);

const TYPE_OPTIONS = Object.entries(ORGANIZATION_TYPE_LABELS) as [OrganizationType, string][];

export function OrganizationRows({
  organizations,
  label,
}: {
  organizations: readonly ContactCard[];
  label: string;
}) {
  return (
    <RowList label={label}>
      {organizations.map((organization) => {
        const emergency = organization.data.phones.some((phone) => phone.emergency);
        return (
          <Row
            key={organization.id}
            to={`/more/organizations/${organization.id}`}
            icon={<AddressBook size={22} aria-hidden />}
            title={
              <>
                {organization.title}
                {emergency ? (
                  <span className="row__status">
                    <Status tone="danger">Есть аварийный телефон</Status>
                  </span>
                ) : null}
              </>
            }
            meta={ORGANIZATION_TYPE_LABELS[organization.data.organizationType]}
            badge={visibilityOf(organization)}
          />
        );
      })}
    </RowList>
  );
}

/** «Ещё → Организации» (CONT-2): список с фильтром по типу под переключателем «Всё · Общее · Личное». */
export function OrganizationsScreen() {
  const [type, setType] = useState<OrganizationType | ''>('');
  const query = useOrganizationsList(false, type === '' ? null : type);
  const { scope, setScope } = useScope();
  const canCreate = useCanCreateOrganization();
  const navigate = useNavigate();
  const typeId = useId();

  const filter = (
    <div className="filters">
      <div className="field">
        <label className="field__label" htmlFor={typeId}>
          Тип организации
        </label>
        <select
          id={typeId}
          className="select"
          value={type}
          onChange={(event) => setType(event.target.value as OrganizationType | '')}
        >
          <option value="">Все типы</option>
          {TYPE_OPTIONS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  if (query.isPending) {
    return (
      <Page title="Организации" back={BACK}>
        <Notice>Загружаем организации…</Notice>
      </Page>
    );
  }
  if (query.data === undefined) {
    return (
      <Page title="Организации" back={BACK}>
        <ObjectError error={query.error} action="load" />
        <button className="text-button" type="button" onClick={() => void query.refetch()}>
          Повторить загрузку организаций
        </button>
      </Page>
    );
  }

  const all = query.data.pages.flat().filter((item) => matchesScope(visibilityOf(item), scope));
  const addButton = canCreate ? (
    <Link className="btn btn--primary btn--block list-action" to={NEW_ORGANIZATION}>
      <Plus size={20} weight="bold" aria-hidden />
      Добавить организацию
    </Link>
  ) : null;

  return (
    <Page
      title="Организации"
      back={BACK}
      {...(all.length > 0 ? { eyebrow: organizationCount(all.length) } : {})}
    >
      {filter}
      {all.length === 0 ? (
        <EmptyState
          icon={<AddressBook size={24} aria-hidden />}
          title={type === '' ? 'Организаций пока нет' : 'Таких организаций нет'}
          actions={
            <>
              {canCreate ? (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => navigate(NEW_ORGANIZATION)}
                >
                  <Plus size={20} weight="bold" aria-hidden />
                  Добавить организацию
                </button>
              ) : null}
              {scope === 'all' ? null : (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={() => setScope('all')}
                >
                  Показать «{SCOPE_LABELS.all}»
                </button>
              )}
              {type === '' ? null : (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={() => setType('')}
                >
                  Показать все типы
                </button>
              )}
            </>
          }
        >
          <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
          <p>
            Организация — это УК, поставщик коммунальных услуг, аварийная служба, банк или школа.
            Номера телефонов видны сразу и копируются одним касанием; по умолчанию организации видит
            вся семья.
          </p>
        </EmptyState>
      ) : (
        <>
          <OrganizationRows organizations={all} label="Организации" />
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
          {addButton}
        </>
      )}
    </Page>
  );
}
