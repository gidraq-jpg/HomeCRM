import { INBOX_STATUSES, InboxDraft } from '@homecrm/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
import { FileMeta } from '../files/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { parseCapturedInbox } from './parse.ts';

export const InboxItem = z.object({
  id: z.uuid(),
  source: z.string(),
  text: z.string(),
  status: z.enum(INBOX_STATUSES),
  draft: InboxDraft.nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  houseId: z.uuid().nullable(),
  consent: z.string().nullable(),
  files: z.array(FileMeta),
});
export type InboxItem = z.infer<typeof InboxItem>;
export const Ok = z.object({ ok: z.literal(true) });
export function useInbox(deleted = false, autoParse = false) {
  const { me } = useHousehold();
  const attempted = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ['inbox', me.id, deleted],
    queryFn: ({ signal }) =>
      apiRequest(
        'GET',
        `inbox${deleted ? '?deleted=1' : ''}`,
        z.array(InboxItem),
        undefined,
        signal,
      ),
    refetchInterval: 3000,
  });
  useEffect(() => {
    if (deleted || !autoParse) return;
    for (const item of query.data ?? []) {
      const key = `${me.id}:${item.id}:${item.consent}:${item.status}`;
      const stale =
        item.status === 'processing' && Date.parse(item.updatedAt) < Date.now() - 120000;
      if ((item.status !== 'new' && !stale) || !item.consent || attempted.current.has(key))
        continue;
      attempted.current.add(key);
      void parseCapturedInbox(item.id)
        .catch(() => undefined)
        .finally(() => query.refetch());
    }
  }, [query.data, query.refetch, me.id, deleted, autoParse]);
  return query;
}
export const inboxAction = (id: string, action: 'trash' | 'restore' | 'resolve', body?: unknown) =>
  apiRequest(
    'POST',
    `inbox/${id}/${action}`,
    Ok.extend({ attachedTo: z.array(z.string()).optional() }),
    body,
  );

/** Устойчивые ключи всех покупок одного черновика переживают перезагрузку страницы. */
export async function inboxOperationKey(id: string, kind: string, index = 0) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${id}:${kind}:${index}`)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 64;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const KIND_LABELS = {
  task: 'Дело',
  shopping: 'Покупка',
  note: 'Заметка',
  meter: 'Показание',
  receipt: 'Начисление',
  document: 'Документ объекта',
  medical: 'Медицинский документ',
};
export const STATUS_LABELS = {
  new: 'Ждёт разбора',
  processing: 'Разбирается…',
  ready: 'Черновик готов',
  error: 'Не удалось разобрать — можно заполнить вручную',
  identity: 'Документ личности — заполните вручную',
};
