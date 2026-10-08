import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCharges, fetchPayments } from './api.ts';

// Ключи запросов содержат только идентификаторы: ни сумм, ни периодов, ни причин в них нет.
const CHARGES = 'charges';

export function useCharges(accountId: string) {
  return useQuery({
    queryKey: [CHARGES, 'list', accountId],
    queryFn: ({ signal }) => fetchCharges(accountId, signal),
  });
}

/** Оплаты начисления грузятся, только когда список раскрыт. */
export function usePayments(chargeId: string, enabled: boolean) {
  return useQuery({
    queryKey: [CHARGES, 'payments', chargeId],
    queryFn: ({ signal }) => fetchPayments(chargeId, signal),
    enabled,
  });
}

/** Что перечитать после денежной записи: начисления, оплаты и радар (срок закрывается и открывается). */
export function useRefreshCharges() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [CHARGES] }),
      client.invalidateQueries({ queryKey: ['deadlines'] }),
    ]);
}
