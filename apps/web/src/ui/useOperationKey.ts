import { useRef } from 'react';
import { uuid } from '../offline/store.ts';

/** Повтор неизменённой формы использует тот же ключ. Данные живут только в памяти. */
export function useOperationKey() {
  const operation = useRef<{ body: string; key: string } | null>(null);
  return (input: unknown): string => {
    const body = JSON.stringify(input);
    if (operation.current?.body !== body) operation.current = { body, key: uuid() };
    return operation.current.key;
  };
}
