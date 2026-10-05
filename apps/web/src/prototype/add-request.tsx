import { createContext, useCallback, useContext, useState } from 'react';
import type { NewRecordKind } from '../access/visibility.ts';

// Кнопка «+» открывает панель добавления. Пустые разделы тоже предлагают «первое действие» и
// открывают ту же панель сразу на нужной форме.

type RequestAdd = (kind?: NewRecordKind) => void;

export const AddRequestContext = createContext<RequestAdd | null>(null);

/** Открыть панель добавления; с `kind` — сразу на форме этого вида. */
export function useAddRequest(): RequestAdd {
  const request = useContext(AddRequestContext);
  if (request === null) throw new Error('useAddRequest нужно вызывать внутри приложения');
  return request;
}

export interface AddController {
  open: boolean;
  requestedKind: NewRecordKind | null;
  request: RequestAdd;
  onOpenChange: (open: boolean) => void;
}

export function useAddController(): AddController {
  const [open, setOpen] = useState(false);
  const [requestedKind, setRequestedKind] = useState<NewRecordKind | null>(null);

  const request = useCallback<RequestAdd>((kind) => {
    setRequestedKind(kind ?? null);
    setOpen(true);
  }, []);

  const onOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setRequestedKind(null);
  }, []);

  return { open, requestedKind, request, onOpenChange };
}
