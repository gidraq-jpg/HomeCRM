import { useEffect, useRef, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Results } from '../search/Results.tsx';
import { useSearch } from '../search/useSearch.ts';
import { CompactEmptyState } from '../ui/EmptyState.tsx';
import { StudioPage as Page } from '../ui/StudioPage.tsx';
import '../search/search.css';

export function SearchScreen() {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { scope } = useScope();
  const result = useSearch(query);
  const q = query.trim();
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <Page service backHistory title="Поиск">
      <div className="field search-field">
        <label className="field__label" htmlFor="search-input">
          Что найти
        </label>
        <input
          ref={input}
          id="search-input"
          className="input"
          type="search"
          autoComplete="off"
          maxLength={200}
          enterKeyHint="search"
          placeholder="Название, номер, телефон, слово из заметки"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="field__hint">Ищем в режиме «{SCOPE_LABELS[scope]}».</p>
      </div>
      {q.length === 0 ? (
        <CompactEmptyState title="Поиск по вашим записям" />
      ) : q.length < 3 ? (
        <p role="status" className="muted">
          Введите хотя бы 3 символа.
        </p>
      ) : !result ? (
        <p role="status" className="muted">
          Ищем…
        </p>
      ) : result.error ? (
        <p role="alert">Не удалось выполнить поиск. Проверьте подключение и попробуйте ещё раз.</p>
      ) : result.data?.total === 0 ? (
        <CompactEmptyState title="Ничего не найдено" />
      ) : result.data ? (
        <Results data={result.data} />
      ) : null}
    </Page>
  );
}
