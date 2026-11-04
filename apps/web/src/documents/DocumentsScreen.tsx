import { DOCUMENT_TYPES, type DocumentType } from '@homecrm/shared';
import { FileText } from '@phosphor-icons/react';
import { useEffect, useId, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMembers } from '../household/queries.ts';
import { visibilityOf } from '../notes/abilities.ts';
import { usePersonName } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { FilterButton, FilterTag } from '../ui/CompactFilters.tsx';
import { ContentMotion } from '../ui/ContentMotion.tsx';
import { CompactEmptyState } from '../ui/EmptyState.tsx';
import { ListSkeleton } from '../ui/ListSkeleton.tsx';
import { Row, RowList, Status } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { StudioPage } from '../ui/StudioPage.tsx';
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
              ? (document.objectTitle ?? 'Объект')
              : document.owner?.kind === 'contact'
                ? (document.ownerContactTitle ?? 'Контакт')
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
                  <Status tone={info.tone}>
                    {info.label}
                    {info.tone === 'warning' || info.tone === 'danger'
                      ? ` · ${info.until.replace(/^до /, '')}`
                      : ''}
                  </Status>
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
  return <CompactEmptyState title="Документов пока нет" />;
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
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ memberId, type, expiry, status });
  const count =
    Number(memberId !== null) +
    Number(type !== null) +
    Number(expiry !== 'any') +
    Number(status !== 'valid');
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
    setStatus('valid');
  }

  return (
    <StudioPage
      title="Документы"
      {...(all.length > 0 ? { eyebrow: documentCount(all.length) } : {})}
    >
      <div className="compact-filters">
        <div className="compact-filters__search">
          <label className="visually-hidden" htmlFor={ids.search}>
            Поиск по названию и типу
          </label>
          <input
            id={ids.search}
            className="input"
            type="search"
            value={text}
            maxLength={200}
            autoComplete="off"
            placeholder="Поиск документов…"
            onChange={(event) => setText(event.target.value)}
          />
          <FilterButton
            count={count}
            onClick={() => {
              setDraft({ memberId, type, expiry, status });
              setOpen(true);
            }}
          />
        </div>
        <ChipGroup
          legend="Срок документа: истекают в ближайшие 90 дней"
          value={expiry}
          options={[
            { value: 'any', label: 'Все' },
            { value: 'expiring', label: 'Истекают' },
            { value: 'expired', label: 'Просрочены' },
          ]}
          onChange={setExpiry}
        />
        <div className="compact-filters__summary">
          {memberId ? (
            <FilterTag
              label={
                people.find((person) => person.accountId === memberId)?.displayName ?? 'Человек'
              }
              onRemove={() => setMemberId(null)}
            />
          ) : null}
          {type ? <FilterTag label={DOCUMENT_LABELS[type]} onRemove={() => setType(null)} /> : null}
          {expiry !== 'any' ? (
            <FilterTag
              label={expiry === 'expiring' ? 'Истекает в 90 дней' : 'Просрочен'}
              onRemove={() => setExpiry('any')}
            />
          ) : null}
          {status !== 'valid' ? (
            <FilterTag label="Все версии" onRemove={() => setStatus('valid')} />
          ) : null}
          {count > 0 || text !== '' ? (
            <button className="text-button" type="button" onClick={reset}>
              Сбросить
            </button>
          ) : null}
        </div>
      </div>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Фильтры документов"
        description="Выберите условия и примените их к списку. Истекают — в ближайшие 90 дней."
      >
        <form
          className="compact-filters__form"
          onSubmit={(event) => {
            event.preventDefault();
            setMemberId(draft.memberId);
            setType(draft.type);
            setExpiry(draft.expiry);
            setStatus(draft.status);
            setOpen(false);
          }}
        >
          <div className="filters__selects">
            <div className="field">
              <label className="field__label" htmlFor={ids.person}>
                Человек
              </label>
              <select
                id={ids.person}
                className="select"
                value={draft.memberId ?? ''}
                onChange={(event) => setDraft({ ...draft, memberId: event.target.value || null })}
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
                value={draft.type ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setDraft({
                    ...draft,
                    type: DOCUMENT_TYPES.find((item) => item === value) ?? null,
                  });
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
              value={draft.expiry}
              options={EXPIRY_OPTIONS}
              onChange={(expiry) => setDraft({ ...draft, expiry })}
            />
          </div>
          <div className="field">
            <span className="field__label" aria-hidden="true">
              Версии
            </span>
            <ChipGroup
              legend="Какие версии показывать"
              value={draft.status}
              options={STATUS_OPTIONS}
              onChange={(status) => setDraft({ ...draft, status })}
            />
          </div>

          <div className="btn-row">
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() =>
                setDraft({ memberId: null, type: null, expiry: 'any', status: 'valid' })
              }
            >
              Сбросить
            </button>
            <button className="btn btn--primary" type="submit">
              Применить
            </button>
          </div>
        </form>
      </Sheet>

      <ContentMotion
        pending={list.isPending}
        version={list.isPending ? 'loading' : all.map((card) => card.id + card.status).join(',')}
      >
        {list.isPending ? <ListSkeleton label="Загружаем документы…" /> : null}
        {list.isError ? (
          <>
            <DocumentError error={list.error} action="load" />
            <button className="text-button" type="button" onClick={() => void list.refetch()}>
              Повторить загрузку документов
            </button>
          </>
        ) : null}

        {list.data && all.length === 0 && !filtered && status === 'valid' ? (
          <EmptyDocuments />
        ) : null}
        {list.data && all.length === 0 && (filtered || status !== 'valid') ? (
          <CompactEmptyState title="Ничего не нашлось">
            <button type="button" className="text-button" onClick={reset}>
              Сбросить фильтры
            </button>
            {scope !== 'all' ? (
              <button type="button" className="text-button" onClick={() => setScope('all')}>
                Показать «{SCOPE_LABELS.all}»
              </button>
            ) : null}
          </CompactEmptyState>
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
          </>
        ) : null}
      </ContentMotion>
    </StudioPage>
  );
}
