import {
  createContext,
  type Dispatch,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import { useScope } from '../access/ScopeContext.tsx';
import { browserStorage, filterByScope, type KeyValueStorage } from '../access/scope.ts';
import type { ProtoRecord, RecordKind, RecordOf } from './model.ts';
import {
  clearState,
  loadState,
  type PrototypeAction,
  type PrototypeState,
  reducer,
  resolveRecords,
  saveState,
} from './state.ts';

interface PrototypeContextValue {
  state: PrototypeState;
  /** Все записи прототипа после изменений — ещё без фильтра по режиму из шапки. */
  records: readonly ProtoRecord[];
  dispatch: Dispatch<PrototypeAction>;
  /** Забыть всё, что сделано в прототипе. Режим «Всё · Общее · Личное» сбрасывается отдельно. */
  resetPrototype: () => void;
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

interface PrototypeProviderProps {
  children: ReactNode;
  /** Хранилище для тестов; по умолчанию — `localStorage` браузера. */
  storage?: KeyValueStorage | null;
}

export function PrototypeProvider({ children, storage }: PrototypeProviderProps) {
  const [store] = useState<KeyValueStorage | null>(() =>
    storage === undefined ? browserStorage() : storage,
  );
  const [state, dispatch] = useReducer(reducer, store, loadState);

  useEffect(() => {
    saveState(store, state);
  }, [store, state]);

  const records = useMemo(() => resolveRecords(state), [state]);

  const resetPrototype = useCallback(() => {
    clearState(store);
    dispatch({ type: 'reset' });
  }, [store]);

  const value = useMemo(
    () => ({ state, records, dispatch, resetPrototype }),
    [state, records, resetPrototype],
  );
  return <PrototypeContext.Provider value={value}>{children}</PrototypeContext.Provider>;
}

export function usePrototype(): PrototypeContextValue {
  const value = useContext(PrototypeContext);
  if (value === null) throw new Error('usePrototype нужно вызывать внутри PrototypeProvider');
  return value;
}

/** Все записи вида, которые видит участник, — без фильтра из шапки. Для карточек и связей. */
export function useAllRecords<K extends RecordKind>(kind: K): RecordOf<K>[] {
  const { records } = usePrototype();
  return useMemo(
    () => records.filter((record): record is RecordOf<K> => record.kind === kind),
    [records, kind],
  );
}

/** Записи вида после фильтра «Всё · Общее · Личное»: так выглядят списки разделов. */
export function useRecords<K extends RecordKind>(kind: K): RecordOf<K>[] {
  const all = useAllRecords(kind);
  const { scope } = useScope();
  return useMemo(() => filterByScope(all, scope), [all, scope]);
}

export function useRecord<K extends RecordKind>(
  kind: K,
  id: string | undefined,
): RecordOf<K> | undefined {
  const all = useAllRecords(kind);
  return useMemo(() => all.find((record) => record.id === id), [all, id]);
}
