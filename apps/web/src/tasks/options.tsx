import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiRequest } from '../auth/api.ts';
import { Notice } from '../auth/components.tsx';
import { fetchMembers } from '../household/api.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { taskError } from './errors.ts';
import { SelectField } from './fields.tsx';
import { uniqueTasks } from './queries.ts';

export type OptionKind =
  | 'object'
  | 'contact'
  | 'document'
  | 'utility_charge'
  | 'utility_account'
  | 'task';
export const OptionRecord = z.object({
  id: z.string(),
  title: z.string(),
  spaceId: z.string(),
  spaceKind: z.enum(['personal', 'household']),
  audience: z.enum(['adults', 'household']).nullable(),
  authorId: z.string(),
  assigneeId: z.string().nullable(),
  deletedAt: z.string().nullable(),
  parentId: z.string().optional(),
});
const paths = {
  task: 'tasks',
  object: 'objects',
  contact: 'contacts',
  document: 'documents',
  utility_charge: 'charges',
  utility_account: 'accounts',
};
export function useOptions(kind: OptionKind, enabled = true, accountId = '') {
  const { me } = useHousehold();
  return useInfiniteQuery({
    queryKey: ['tasks', me.id, 'options', kind, accountId],
    enabled: enabled && (kind !== 'utility_charge' || !!accountId),
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) =>
      apiRequest(
        'GET',
        `${kind === 'utility_charge' ? `accounts/${accountId}/charges` : paths[kind]}?limit=50&offset=${pageParam}`,
        z.array(OptionRecord),
        undefined,
        signal,
      ),
    getNextPageParam: (last, pages) => (last.length === 50 ? pages.length * 50 : undefined),
  });
}
export function useTaskMembers(householdId: string | null, enabled = true) {
  const { me } = useHousehold();
  return useQuery({
    queryKey: ['tasks', me.id, householdId, 'members'],
    enabled: !!householdId && enabled,
    queryFn: ({ signal }) => fetchMembers(householdId ?? '', signal),
  });
}
/** Выбранный конец не исчезает при подгрузке или если он находится за первой страницей. */
export function RecordPicker({
  kind,
  label,
  value,
  onChange,
  accountId = '',
  selectedTitle,
}: {
  kind: OptionKind;
  label: string;
  value: string;
  onChange: (value: string) => void;
  accountId?: string;
  selectedTitle?: string;
}) {
  const query = useOptions(kind, true, accountId);
  const { me } = useHousehold();
  const current = useQuery({
    queryKey: ['tasks', me.id, 'option', kind, value],
    enabled: !!value && !query.data?.pages.flat().some((item) => item.id === value),
    queryFn: ({ signal }) =>
      apiRequest('GET', `${paths[kind]}/${value}`, OptionRecord, undefined, signal),
  });
  const items = uniqueTasks([
    ...(query.data?.pages.flat() ?? []),
    ...(current.data ? [current.data] : []),
  ]);
  return (
    <>
      <SelectField
        label={label}
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: 'Не выбрано' },
          ...items.map((item) => ({ value: item.id, label: item.title })),
          ...(value && !items.some((item) => item.id === value)
            ? [{ value, label: selectedTitle ?? 'Ранее выбранная запись' }]
            : []),
        ]}
      />
      {query.isPending && kind !== 'utility_charge' ? <Notice>Загружаем варианты…</Notice> : null}
      {query.error ? (
        <Notice error>
          {taskError(query.error)}
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку вариантов
          </button>
        </Notice>
      ) : null}
      {query.hasNextPage ? (
        <button
          type="button"
          className="text-button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Ещё варианты: {label.toLowerCase()}
        </button>
      ) : null}
    </>
  );
}
export function MemberPicker({
  label = 'Исполнитель',
  householdId,
  value,
  onChange,
}: {
  label?: string;
  householdId: string | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const { me } = useHousehold();
  const query = useTaskMembers(householdId);
  const people = [
    { value: me.id, label: me.displayName },
    ...(query.data ?? [])
      .filter((person) => !person.formerMember && person.accountId !== me.id)
      .map((person) => ({ value: person.accountId, label: person.displayName })),
  ];
  if (value && !people.some((person) => person.value === value))
    people.push({ value, label: 'Прежний исполнитель' });
  return (
    <>
      <SelectField label={label} value={value} onChange={onChange} options={people} />
      {query.isError ? (
        <Notice error>
          {taskError(query.error)}
          <button type="button" className="text-button" onClick={() => void query.refetch()}>
            Повторить загрузку участников
          </button>
        </Notice>
      ) : null}
    </>
  );
}
