import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { noteAbilities, viewerOf } from '../notes/abilities.ts';
import { fetchObjects } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { usePersonName } from '../objects/context.ts';
import { todayIn } from '../objects/dates.ts';
import { type DateOnly, formatRub, formatShortDate } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import {
  createInteraction,
  type Interaction,
  type InteractionInput,
  patchInteraction,
  restoreInteraction,
  trashInteraction,
} from './api.ts';
import { InteractionForm } from './InteractionForm.tsx';
import { emptyInteractionDraft, interactionDraft } from './interaction-form.ts';
import { interactionCount, KIND_LABELS } from './labels.ts';
import { useInteractions, useRefreshContacts } from './queries.ts';

/** Объекты, которые видит участник: к ним можно привязать взаимодействие. */
export function useObjectChoices(enabled: boolean) {
  return useQuery({
    queryKey: ['objects', 'choices'],
    queryFn: ({ signal }) => fetchObjects('all', { trash: false, offset: 0 }, signal),
    enabled,
  });
}

const INTERACTION_TYPE = 'contact_interaction';

function InteractionItem({
  contactId,
  item,
  canEdit,
  objects,
  editing,
  onEdit,
  onClose,
}: {
  contactId: string;
  item: Interaction;
  canEdit: boolean;
  objects: readonly { id: string; title: string }[];
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { me, householdId } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const nameOf = usePersonName();
  const quick = useAction();
  const save = useAction();
  const today = todayIn(me.timeZone);
  const abilities = noteAbilities(viewerOf(me), item, householdId, INTERACTION_TYPE);

  function saveEdited(values: InteractionInput) {
    void save.run(async () => {
      await patchInteraction(contactId, item.id, {
        ...values,
        ...(item.objectId === null && values.objectId === null ? { objectId: undefined } : {}),
        expectedUpdatedAt: item.updatedAt,
      });
      await refresh();
      onClose();
      toast.show({ message: 'Запись сохранена' });
    });
  }

  function trash() {
    void quick.run(async () => {
      await trashInteraction(contactId, item.id);
      await refresh();
      toast.show({
        message: 'Запись в корзине',
        detail: 'Хранится 30 дней',
        ...(abilities.restore
          ? {
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreInteraction(contactId, item.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Запись возвращена' }))
                    .catch(() => toast.show({ message: 'Не удалось вернуть запись' }));
                },
              },
            }
          : {}),
      });
    });
  }

  if (editing) {
    return (
      <li className="timeline__item timeline__item--editing">
        <InteractionForm
          draft={interactionDraft(item)}
          objects={objects}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          state={save}
          onSubmit={saveEdited}
          onCancel={() => {
            save.setError(null);
            onClose();
          }}
          onReload={() => {
            save.setError(null);
            onClose();
            void refresh();
          }}
        />
      </li>
    );
  }

  const facts = [
    item.amountCents === null ? null : (
      <span key="amount" className="amount">
        {formatRub(item.amountCents)}
      </span>
    ),
    item.callAgain === null ? null : (
      <span key="again">{item.callAgain ? 'Звать снова: да' : 'Звать снова: нет'}</span>
    ),
    item.object === null ? null : (
      <span key="object">
        Объект:{' '}
        <Link className="text-button" to={`/home/${item.object.id}`}>
          {item.object.title}
        </Link>
      </span>
    ),
  ].filter((fact) => fact !== null);

  return (
    <li className="timeline__item">
      <div className="timeline__head">
        <span className="timeline__date">
          {formatShortDate(item.occurredOn as DateOnly, today)}
        </span>
        <span>{KIND_LABELS[item.kind]}</span>
        <span>Записал(а): {nameOf(item.authorId)}</span>
      </div>
      <p className="timeline__text">{item.text}</p>
      {facts.length > 0 ? <div className="timeline__facts">{facts}</div> : null}
      {canEdit && (abilities.edit || abilities.trash) ? (
        <div className="timeline__tools">
          {abilities.edit ? (
            <button type="button" className="btn btn--secondary" onClick={onEdit}>
              <PencilSimple size={20} aria-hidden />
              Править
            </button>
          ) : null}
          {abilities.trash ? (
            <button
              type="button"
              className="btn btn--secondary"
              disabled={quick.disabled}
              onClick={trash}
            >
              <Trash size={20} aria-hidden />
              {quick.pending ? 'Убираем…' : 'В корзину'}
            </button>
          ) : null}
        </div>
      ) : null}
      <ObjectError error={quick.error} action="interaction" />
    </li>
  );
}

/**
 * «Взаимодействия» в карточке контакта (CONT-4): звонки, визиты, сообщения и работы по дате,
 * новые сверху. Добавляет тот, кто может править контакт; ребёнок «Взрослых» их не видит вовсе.
 */
export function InteractionsSection({
  contactId,
  canAdd,
}: {
  contactId: string;
  /** Контакт можно править и он не в корзине. */
  canAdd: boolean;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshContacts();
  const query = useInteractions(contactId);
  const objects = useObjectChoices(canAdd || query.data !== undefined);
  const adding = useAction();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const items = query.data?.pages.flat() ?? [];
  const choices = (objects.data ?? []).map(({ id, title }) => ({ id, title }));

  function add(values: InteractionInput) {
    void adding.run(async () => {
      await createInteraction(contactId, values);
      await refresh();
      setFormOpen(false);
      toast.show({ message: 'Запись добавлена' });
    });
  }

  return (
    <section className="section" aria-labelledby={`interactions-${contactId}`}>
      <div className="section__head">
        <h2 className="section__title" id={`interactions-${contactId}`}>
          Взаимодействия
        </h2>
        {items.length > 0 ? <span className="muted">{interactionCount(items.length)}</span> : null}
      </div>

      {canAdd ? (
        formOpen ? (
          <InteractionForm
            draft={emptyInteractionDraft(todayIn(me.timeZone))}
            objects={choices}
            submitLabel="Добавить"
            pendingLabel="Добавляем…"
            state={adding}
            onSubmit={add}
            onCancel={() => {
              adding.setError(null);
              setFormOpen(false);
            }}
          />
        ) : (
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить взаимодействие
          </button>
        )
      ) : null}

      {query.isPending ? <Notice>Загружаем взаимодействия…</Notice> : null}
      {query.isError && items.length === 0 ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку взаимодействий
          </button>
        </>
      ) : null}
      {query.data && items.length === 0 ? (
        <p className="muted">
          Пока ничего нет. Записывайте звонки, визиты и работы: дату, что было, сколько стоило и
          стоит ли звать снова.
        </p>
      ) : null}
      {items.length > 0 ? (
        <ul className="timeline" aria-label="Взаимодействия">
          {items.map((item) => (
            <InteractionItem
              key={item.id}
              contactId={contactId}
              item={item}
              canEdit={canAdd}
              objects={choices}
              editing={editingId === item.id}
              onEdit={() => {
                setFormOpen(false);
                setEditingId(item.id);
              }}
              onClose={() => setEditingId(null)}
            />
          ))}
        </ul>
      ) : null}
      {query.hasNextPage ? (
        <button
          type="button"
          className="btn btn--secondary btn--block list-action"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Загружаем…' : 'Показать ещё'}
        </button>
      ) : null}
    </section>
  );
}
