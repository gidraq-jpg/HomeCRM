import { AUDIENCES, UtilityAccountData } from '@homecrm/shared';
import * as z from 'zod';
import { apiRequest } from '../auth/api.ts';

// Лицевые счета (UTIL-2, ADR-0031, docs/property-accounts-api.md). Счёт дочерний: место и
// аудиторию он получает от объекта. Номера счетов, ссылки и заметки живут только в ответах и
// памяти страницы: в адреса, журнал, localStorage и кэш сервис-воркера они не попадают.

export const DEFAULT_ACCOUNT_TITLE = 'Лицевой счёт';
export const MAX_TITLE = 200;

export const AccountCard = z.object({
  id: z.string(),
  title: z.string(),
  parentId: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(AUDIENCES).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  data: UtilityAccountData,
  /** Скрытый от читателя и отсутствующий поставщик сервер отдаёт одинаково: двумя `null`. */
  supplierId: z.string().nullable(),
  supplier: z
    .object({ id: z.string(), title: z.string(), deletedAt: z.string().nullable() })
    .nullable(),
});
export type AccountCard = z.infer<typeof AccountCard>;

export interface AccountInput {
  title?: string;
  supplierId?: string | null;
  data: UtilityAccountData;
}

export type AccountChange = Partial<AccountInput> & { expectedUpdatedAt?: string };

export const PAGE_SIZE = 100;

export function fetchAccounts(objectId: string, trash: boolean, signal?: AbortSignal) {
  const query = new URLSearchParams({ trash: String(trash), limit: String(PAGE_SIZE) });
  return apiRequest(
    'GET',
    `objects/${objectId}/accounts?${query}`,
    z.array(AccountCard),
    undefined,
    signal,
  );
}

export function createAccount(objectId: string, input: AccountInput) {
  return apiRequest('POST', `objects/${objectId}/accounts`, AccountCard, input);
}

export function patchAccount(id: string, change: AccountChange) {
  return apiRequest('PATCH', `accounts/${id}`, AccountCard, change);
}

export function trashAccount(id: string) {
  return apiRequest('POST', `accounts/${id}/trash`, AccountCard, {});
}

export function restoreAccount(id: string) {
  return apiRequest('POST', `accounts/${id}/restore`, AccountCard, {});
}
