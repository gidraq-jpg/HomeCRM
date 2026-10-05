import {
  AddressBook,
  Buildings,
  CheckCircle,
  FileText,
  MagnifyingGlass,
  Note,
  ShoppingCart,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { useScope } from '../../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../../access/scope.ts';
import { CopyButton } from '../../ui/CopyButton.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { countWord } from '../../ui/format.ts';
import { Page, Section } from '../../ui/Page.tsx';
import { TODAY } from '../data/index.ts';
import { buildSearchEntries, countResults, type SearchGroup, searchEntries } from '../search.ts';
import { usePrototype } from '../store.tsx';

const GROUP_ICONS: Readonly<Record<SearchGroup, ReactNode>> = {
  home: <Buildings size={22} aria-hidden />,
  documents: <FileText size={22} aria-hidden />,
  people: <AddressBook size={22} aria-hidden />,
  tasks: <CheckCircle size={22} aria-hidden />,
  notes: <Note size={22} aria-hidden />,
  shopping: <ShoppingCart size={22} aria-hidden />,
};

/** Поиск по всем записям, которые видит участник; личное — со значком замка (7.3.10, SRCH). */
export function SearchScreen() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const { records } = usePrototype();
  const { scope, setScope } = useScope();
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const entries = useMemo(() => buildSearchEntries(records, TODAY), [records]);
  const groups = useMemo(() => searchEntries(entries, query, scope), [entries, query, scope]);
  const total = countResults(groups);
  const everywhere = useMemo(
    () => (scope === 'all' ? total : countResults(searchEntries(entries, query, 'all'))),
    [entries, query, scope, total],
  );
  const searching = query.trim() !== '';

  return (
    <Page title="Поиск">
      <div className="field search-field">
        <label className="field__label" htmlFor="search-input">
          Что найти
        </label>
        <input
          id="search-input"
          ref={input}
          className="input"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Название, номер, телефон, слово из заметки"
          value={query}
          onChange={(event) => {
            const value = event.target.value;
            setParams(value === '' ? {} : { q: value }, { replace: true });
          }}
        />
        <p className="field__hint">Ищем в режиме «{SCOPE_LABELS[scope]}».</p>
      </div>

      {!searching ? (
        <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Поиск по всем записям">
          <p>
            Находит названия, номера счетов и документов, телефоны и слова из заметок. Личные записи
            помечены замком.
          </p>
        </EmptyState>
      ) : total === 0 ? (
        <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Ничего не найдено">
          {everywhere > 0 ? (
            <p>
              В режиме «{SCOPE_LABELS[scope]}» совпадений нет, а во всех записях нашлось:{' '}
              {everywhere}.
            </p>
          ) : (
            <p>Попробуйте другое слово или часть номера.</p>
          )}
          {everywhere > 0 ? (
            <button
              type="button"
              className="btn btn--primary btn--block"
              onClick={() => setScope('all')}
            >
              Искать во всём
            </button>
          ) : null}
        </EmptyState>
      ) : (
        <>
          <p className="muted" role="status">
            Найдено: {countWord(total, ['запись', 'записи', 'записей'])}
          </p>
          {groups.map(({ group, label, entries: found }) => (
            <Section
              key={group}
              title={label}
              aside={<span className="muted">{found.length}</span>}
            >
              <ul className="row-list">
                {found.map((entry) => (
                  <li key={`${entry.group}-${entry.id}`} className="result">
                    <Link className="row" to={entry.to}>
                      <span className="row__icon">{GROUP_ICONS[entry.group]}</span>
                      <span className="row__body">
                        <span className="row__title">{entry.title}</span>
                        <span className="row__meta">{entry.subtitle}</span>
                      </span>
                      <AccessBadge visibility={entry.visibility} />
                    </Link>
                    {entry.copy ? (
                      <CopyButton value={entry.copy.value} what={entry.copy.what} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </>
      )}
    </Page>
  );
}
