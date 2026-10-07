import { MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Results } from '../search/Results.tsx';
import { useSearch } from '../search/useSearch.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
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
    <Page title="Поиск">
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
        <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Поиск по вашим записям">
          <p>
            Найдите заметку, объект или событие по названию, слову или части номера. Личное видите
            только вы.
          </p>
        </EmptyState>
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
        <EmptyState icon={<MagnifyingGlass size={24} aria-hidden />} title="Ничего не найдено">
          <p>Попробуйте другое слово или часть номера. Проверьте режим «Всё · Общее · Личное».</p>
        </EmptyState>
      ) : result.data ? (
        <Results data={result.data} />
      ) : null}
    </Page>
  );
}
