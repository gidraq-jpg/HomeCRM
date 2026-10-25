import { canWrite, canWriteLink } from '@homecrm/shared';
import { Plus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiRequest } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf } from '../notes/abilities.ts';
import { createLink, fetchLinks, type RecordLink, trashLink } from '../objects/api.ts';
import { Link } from '../shell/motion.tsx';
import { Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import type { TaskCard } from './api.ts';
import { taskError } from './errors.ts';
import { SelectField, TextField } from './fields.tsx';
import { type OptionKind, OptionRecord, RecordPicker } from './options.tsx';

const paths: Record<string, string> = {
  object: 'objects',
  contact: 'contacts',
  document: 'documents',
  utility_charge: 'charges',
  note: 'notes',
  task: 'tasks',
};
function LinkedRecord({ link, card }: { link: RecordLink; card: TaskCard }) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const state = useAction();
  const client = useQueryClient();
  const ref = link.left.id === card.id ? link.right : link.left;
  const collection = paths[ref.type];
  const end = useQuery({
    queryKey: ['tasks', me.id, 'link-end', ref.type, ref.id],
    enabled: !!collection,
    queryFn: ({ signal }) =>
      apiRequest('GET', `${collection}/${ref.id}`, OptionRecord, undefined, signal),
  });
  const account = useQuery({
    queryKey: ['tasks', me.id, 'link-account', end.data?.parentId],
    enabled: ref.type === 'utility_charge' && !!end.data?.parentId,
    queryFn: ({ signal }) =>
      apiRequest('GET', `accounts/${end.data?.parentId}`, OptionRecord, undefined, signal),
  });
  if (!end.data) return null;
  const to =
    ref.type === 'object'
      ? `/home/${ref.id}`
      : ref.type === 'contact'
        ? `/people/contacts/${ref.id}`
        : ref.type === 'document'
          ? `/documents/${ref.id}`
          : ref.type === 'task'
            ? `/today/tasks/${ref.id}`
            : ref.type === 'note'
              ? `/more/notes/${ref.id}`
              : account.data?.parentId
                ? `/home/${account.data.parentId}/accounts/${account.data.id}/charges`
                : null;
  return (
    <li className="task-link-row">
      {to ? (
        <Link className="text-button" to={to}>
          {end.data.title}
          {link.role ? ` · ${link.role}` : ''}
        </Link>
      ) : (
        <span>{end.data.title}</span>
      )}
      {canWriteLink(viewer, factsOf(card, viewer, 'task'), factsOf(end.data, viewer, ref.type)) ? (
        <button
          className="btn btn--secondary"
          type="button"
          disabled={state.disabled}
          onClick={() =>
            void state.run(async () => {
              await trashLink(link.id);
              await client.invalidateQueries({ queryKey: ['tasks'] });
              await client.invalidateQueries({ queryKey: ['links'] });
            })
          }
        >
          Убрать связь
        </button>
      ) : null}
      {state.error ? <Notice error>{taskError(state.error)}</Notice> : null}
    </li>
  );
}
export function TaskLinks({ card }: { card: TaskCard }) {
  const { me } = useHousehold();
  const client = useQueryClient();
  const state = useAction();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OptionKind>('object');
  const [id, setId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [role, setRole] = useState('');
  const query = useQuery({
    queryKey: ['tasks', me.id, 'links', card.id],
    queryFn: ({ signal }) => fetchLinks({ type: 'task', id: card.id }, signal),
  });
  return (
    <Section
      title="Связи"
      aside={
        canWrite(viewerOf(me), factsOf(card, viewerOf(me), 'task')) ? (
          <button
            className="icon-button"
            aria-label="Добавить связь…"
            type="button"
            onClick={() => setOpen(true)}
          >
            <Plus size={20} aria-hidden />
          </button>
        ) : null
      }
    >
      {query.error ? (
        <Notice error>
          {taskError(query.error)}
          <button type="button" className="text-button" onClick={() => void query.refetch()}>
            Обновить связи
          </button>
        </Notice>
      ) : null}
      <ul className="task-links">
        {query.data?.map((link) => (
          <LinkedRecord key={link.id} link={link} card={card} />
        ))}
      </ul>

      {open ? (
        <Sheet
          open
          onOpenChange={setOpen}
          title="Связать дело"
          description="Связь видна только тем, кто видит обе записи."
        >
          <SelectField
            label="Вид связи"
            value={kind}
            onChange={(value) => {
              setKind(value as OptionKind);
              setId('');
            }}
            options={[
              { value: 'object', label: 'Объект' },
              { value: 'contact', label: 'Контакт' },
              { value: 'document', label: 'Документ' },
              { value: 'utility_charge', label: 'Начисление' },
            ]}
          />
          {kind === 'utility_charge' ? (
            <RecordPicker
              kind="utility_account"
              label="Лицевой счёт начисления"
              value={accountId}
              onChange={(value) => {
                setAccountId(value);
                setId('');
              }}
            />
          ) : null}
          <RecordPicker
            key={`${kind}:${accountId}`}
            kind={kind}
            label="Запись для связи"
            value={id}
            onChange={setId}
            accountId={accountId}
          />
          <TextField label="Подпись связи" value={role} maxLength={200} onChange={setRole} />
          {state.error ? <Notice error>{taskError(state.error)}</Notice> : null}
          <button
            className="btn btn--primary"
            type="button"
            disabled={!id || state.disabled}
            onClick={() =>
              void state.run(async () => {
                await createLink({ type: 'task', id: card.id }, { type: kind, id }, role);
                await query.refetch();
                await client.invalidateQueries({ queryKey: ['links'] });
                setOpen(false);
              })
            }
          >
            Связать
          </button>
        </Sheet>
      ) : null}
    </Section>
  );
}
