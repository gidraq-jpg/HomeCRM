import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  browserStorage,
  clearScope,
  DEFAULT_SCOPE,
  filterByScope,
  type KeyValueStorage,
  loadScope,
  type Scope,
  saveScope,
} from './scope.ts';
import type { Visibility } from './visibility.ts';

interface ScopeContextValue {
  scope: Scope;
  setScope: (scope: Scope) => void;
  /** Вернуть «Всё» и забыть сохранённый выбор. */
  resetScope: () => void;
}

const ScopeContext = createContext<ScopeContextValue | null>(null);

interface ScopeProviderProps {
  children: ReactNode;
  /** Хранилище для тестов; по умолчанию — `localStorage` браузера. */
  storage?: KeyValueStorage | null;
}

export function ScopeProvider({ children, storage }: ScopeProviderProps) {
  const [store] = useState<KeyValueStorage | null>(() =>
    storage === undefined ? browserStorage() : storage,
  );
  const [scope, setScopeState] = useState<Scope>(() => loadScope(store));

  const setScope = useCallback(
    (next: Scope) => {
      setScopeState(next);
      saveScope(store, next);
    },
    [store],
  );

  const resetScope = useCallback(() => {
    setScopeState(DEFAULT_SCOPE);
    clearScope(store);
  }, [store]);

  const value = useMemo(() => ({ scope, setScope, resetScope }), [scope, setScope, resetScope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeContextValue {
  const value = useContext(ScopeContext);
  if (value === null) throw new Error('useScope нужно вызывать внутри ScopeProvider');
  return value;
}

/** Оставляет записи, подходящие под выбранный в шапке режим. */
export function useScoped<T extends { visibility: Visibility }>(items: readonly T[]): T[] {
  const { scope } = useScope();
  return useMemo(() => filterByScope(items, scope), [items, scope]);
}
