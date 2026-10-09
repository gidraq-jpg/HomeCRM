import { DOCUMENT_TYPES, type DocumentType } from '@homecrm/shared';
import { FileText, Plus } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { usePersonName } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';
import {
  type DocumentCard,
  type DocumentExpiryFilter,
  type DocumentFilters,
  type DocumentStatusFilter,
  NO_FILTERS,
} from './api.ts';
import { DocumentError } from './components.tsx';
import { DOCUMENT_LABELS, documentCount, expiryInfo, TYPE_OPTIONS } from './labels.ts';
import { useDocumentsList } from './queries.ts';

export const NEW_DOCUMENT = '/documents/new';

type ExpiryChoice = 'any' | DocumentExpiryFilter;
const EXPIRY_OPTIONS = [
  { value: 'any', label: 'Любой срок' },
  { value: 'expiring', label: 'Истекает в 90 дней' },
  { value: 'expired', label: 'Просрочен' },
] as const satisfies readonly { value: ExpiryChoice; label: string }[];

const STATUS_OPTIONS = [
  { value: 'valid', label: 'Действующие' },
  { value: 'all', label: 'Все версии' },
] as const satisfies readonly { value: DocumentStatusFilter; label: string }[];

/** Строки списка документов: тип, владелец-участник, срок и значок «Кто видит». */
export function DocumentRows({
  documents,
  label,
}: {
  documents: readonly DocumentCard[];
  label: string;
}) {
  const { me } = useHousehold();
  const nameOf = usePersonName();
  const today = todayIn(me.timeZone);
  return (
    <RowList label={label}>
      {documents.map((document) => {
        const visibility = visibilityOf(document);
        const info = expiryInfo(
          document.data,
          document.status === 'valid',
          today,
          document.expiryRule,
        );
        const owner =
          document.owner?.kind === 'member'
            ? nameOf(document.owner.id)
            : document.owner?.kind === 'object'
              ? 'Объект'
              : document.owner?.kind === 'contact'
                ? 'Контакт'
                : null;
        return (
          <Row
            key={document.id}
            to={`/documents/${document.id}`}
            icon={<FileText size={22} aria-hidden />}
            title={document.title}
            meta={
              <>
                <span className="radar-line">
                  {[DOCUMENT_LABELS[document.data.type], owner].filter(Boolean).join(' · ')}
                </span>
                <span className="radar-line row__state">
                  <Status tone={info.tone}>{info.label}</Status>
                </span>
              </>
            }
            badge={visibility}
          />
        );
      })}
    </RowList>
  );
}

/** Пустой раздел объясняет разницу личного и общего и предлагает первое действие — TPL-4, PRD 7.4. */
function EmptyDocuments() {
  const { scope, setScope } = useScope();
  return (
    <EmptyState
      icon={<FileText size={24} aria-hidden />}
      title="Документов пока нет"
      actions={
        <>
          <Link className="btn btn--primary btn--block" to={NEW_DOCUMENT}>
            <Plus size={20} weight="bold" aria-hidden />
            Добавить документ
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
          <Link className="text-button" to="/more/spaces">
            Как устроены личное и общее
          </Link>
        </>
      }
    >
      <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p>
      <p>
        Паспорта, полисы, договоры и справки со сроками, номерами и сканами страниц. Документ
        взрослого по умолчанию личный, документ ребёнка видят взрослые дома, а документ объекта
        виден так же, как сам объект.
      </p>
    </EmptyState>
  );
}

/** Поисковая строка ждёт паузу в наборе: запрос к серверу уходит не на каждую букву. */
function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * «Документы» (DOC-1…2, DOC-7): список с фильтрами по человеку, типу и сроку, поиск по названию и
 * типу. Пространство задаёт общий переключатель «Всё · Общее · Личное» в шапке.
 */
export function DocumentsScreen() {
  const { scope, setScope } = useScope();
  const members = useMembers();
  const ids = { person: useId(), type: useId(), search: useId() };
  const [memberId, setMemberId] = useState<string | null>(null);
  const [type, setType] = useState<DocumentType | null>(null);
  const [expiry, setExpiry] = useState<ExpiryChoice>('any');
  const [status, setStatus] = useState<DocumentStatusFilter>('valid');
  const [text, setText] = useState('');
  const query = useDebounced(text, 250);

  const filters: Omit<DocumentFilters, 'scope'> = {
    ...NO_FILTERS,
    memberId,
    type,
    expiry: expiry === 'any' ? null : expiry,
    status,
    query,
  };
  const list = useDocumentsList(filters);
  const filtered = memberId !== null || type !== null || expiry !== 'any' || query.trim() !== '';

  const people = (members.data ?? []).filter((member) => !member.formerMember);
  const all = list.data?.pages.flat() ?? [];

  function reset() {
    setMemberId(null);
    setType(null);
    setExpiry('any');
    setText('');
  }

  return (
    <Page title="Документы" {...(all.length > 0 ? { eyebrow: documentCount(all.length) } : {})}>
      <div className="filters document-filters">
        <div className="field">
          <label className="field__label" htmlFor={ids.search}>
            Поиск по названию и типу
          </label>
          <input
            id={ids.search}
            className="input"
            type="search"
            value={text}
            maxLength={200}
            autoComplete="off"
            placeholder="Например: загранпаспорт"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="filters__selects">
          <div className="field">
            <label className="field__label" htmlFor={ids.person}>
              Человек
            </label>
            <select
              id={ids.person}
              className="select"
              value={memberId ?? ''}
              onChange={(event) => setMemberId(event.target.value || null)}
            >
              <option value="">Все</option>
              {people.map((member) => (
                <option key={member.accountId} value={member.accountId}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.type}>
              Тип
            </label>
            <select
              id={ids.type}
              className="select"
              value={type ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setType(DOCUMENT_TYPES.find((item) => item === value) ?? null);
              }}
            >
              <option value="">Все типы</option>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="field__label" aria-hidden="true">
            Срок
          </span>
          <ChipGroup
            legend="Срок документа"
            value={expiry}
            options={EXPIRY_OPTIONS}
            onChange={setExpiry}
          />
        </div>
        <div className="field">
          <span className="field__label" aria-hidden="true">
            Версии
          </span>
          <ChipGroup
            legend="Какие версии показывать"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
          />
        </div>
      </div>

      {list.isPending ? <Notice>Загружаем документы…</Notice> : null}
      {list.isError ? (
        <>
          <DocumentError error={list.error} action="load" />
          <button className="text-button" type="button" onClick={() => void list.refetch()}>
            Повторить загрузку документов
          </button>
        </>
      ) : null}

      {list.data && all.length === 0 && !filtered && status === 'valid' ? <EmptyDocuments /> : null}
      {list.data && all.length === 0 && (filtered || status !== 'valid') ? (
        <EmptyState icon={<FileText size={24} aria-hidden />} title="Ничего не нашлось">
          <p>
            Под выбранные фильтры документов нет.
            {scope === 'all' ? '' : ` Сейчас включён режим «${SCOPE_LABELS[scope]}».`}
          </p>
          <div className="empty-state__actions">
            <button type="button" className="btn btn--secondary btn--block" onClick={reset}>
              Сбросить фильтры
            </button>
            {scope === 'all' ? null : (
              <button
                type="button"
                className="btn btn--secondary btn--block"
                onClick={() => setScope('all')}
              >
                Показать «{SCOPE_LABELS.all}»
              </button>
            )}
          </div>
        </EmptyState>
      ) : null}

      {all.length > 0 ? (
        <>
          <DocumentRows documents={all} label="Документы" />
          {list.hasNextPage ? (
            <button
              type="button"
              className="btn btn--secondary btn--block list-action"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
            </button>
          ) : null}
          <Link className="btn btn--primary btn--block list-action" to={NEW_DOCUMENT}>
            <Plus size={20} weight="bold" aria-hidden />
            Добавить документ
          </Link>
        </>
      ) : null}
    </Page>
  );
}
