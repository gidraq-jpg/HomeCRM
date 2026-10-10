import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Notice, useAction } from '../auth/components.tsx';
import { formatMoment } from '../auth/dates.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { routeOf, useEnd } from '../links/ends.ts';
import type { MeterListItem } from '../meters/api.ts';
import { showDecimal, showWithUnit } from '../meters/decimal.ts';
import { RESOURCE_UNITS, zoneLabel } from '../meters/labels.ts';
import { useMeters } from '../meters/queries.ts';
import { viewerOf } from '../notes/abilities.ts';
import { KIND_LABELS } from '../people/labels.ts';
import { EmptyState } from '../ui/EmptyState.tsx';
import { type DateOnly, formatRub, formatShortDate } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import { type EventAbilities, eventAbilities } from './abilities.ts';
import {
  type AutoEvent,
  createEvent,
  type EventInput,
  type InteractionEvent,
  type ManualEvent,
  type ObjectCard,
  patchEvent,
  type ReadingEvent,
  restoreEvent,
  trashEvent,
} from './api.ts';
import { ObjectError } from './components.tsx';
import { useObjectContext, usePersonName } from './context.ts';
import { todayIn } from './dates.ts';
import { EventForm } from './EventForm.tsx';
import { isStaleVersion } from './errors.ts';
import { useRefreshObjects, useTimeline } from './queries.ts';
import { describeAuto, ratingText, stars } from './timeline.ts';

/** Контакт события: название видимой записи или просто «Контакт». Невидимый приходит как `null`. */
function Contact({ contact }: { contact: NonNullable<ManualEvent['contact']> }) {
  const { me } = useHousehold();
  const end = useEnd(contact, viewerOf(me));
  const to = routeOf(contact);
  const title = end.title ?? 'Контакт';
  return (
    <span>
      Контакт:{' '}
      {to === null ? (
        title
      ) : (
        <Link className="text-button" to={to}>
          {title}
        </Link>
      )}
    </span>
  );
}

function ManualItem({
  card,
  event,
  abilities,
  editing,
  onEdit,
  onClose,
}: {
  card: ObjectCard;
  event: ManualEvent;
  abilities: EventAbilities;
  editing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const nameOf = usePersonName();
  const quick = useAction();
  const save = useAction();
  const [conflict, setConflict] = useState(false);
  const today = todayIn(me.timeZone);

  function saveEdited(values: EventInput) {
    void save.run(async () => {
      try {
        await patchEvent(card.id, event.id, { ...values, expectedUpdatedAt: event.updatedAt });
      } catch (error) {
        // Версию не перечитываем: повторное «Сохранить» снова даст конфликт, а не затрёт чужую правку.
        if (isStaleVersion(error)) {
          setConflict(true);
          return;
        }
        throw error;
      }
      await refresh();
      setConflict(false);
      onClose();
      toast.show({ message: 'Событие сохранено' });
    });
  }

  function saveAsCopy(values: EventInput) {
    void save.run(async () => {
      await createEvent(card.id, values);
      await refresh();
      setConflict(false);
      onClose();
      toast.show({
        message: 'Ваша версия сохранена отдельным событием',
        detail: 'Свежая версия исходного события осталась как есть.',
      });
    });
  }

  function reload() {
    save.setError(null);
    setConflict(false);
    onClose();
    void refresh();
  }

  function trash() {
    void quick.run(async () => {
      await trashEvent(card.id, event.id);
      await refresh();
      toast.show({
        message: 'Событие в корзине',
        detail: 'Хранится 30 дней',
        ...(abilities.restore
          ? {
              action: {
                label: 'Отменить',
                onClick: () => {
                  restoreEvent(card.id, event.id)
                    .then(() => refresh())
                    .then(() => toast.show({ message: 'Событие возвращено' }))
                    .catch(() => toast.show({ message: 'Не удалось вернуть событие' }));
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
        <EventForm
          draft={{
            occurredOn: event.occurredOn,
            text: event.text,
            amountKopecks: event.amountKopecks,
            rating: event.rating,
          }}
          submitLabel="Сохранить"
          pendingLabel="Сохраняем…"
          state={save}
          onSubmit={saveEdited}
          onCancel={() => {
            save.setError(null);
            setConflict(false);
            onClose();
          }}
          {...(conflict ? { conflict: { onReload: reload, onSaveCopy: saveAsCopy } } : {})}
        />
      </li>
    );
  }

  const extras = [
    event.amountKopecks === null ? null : (
      <span key="amount" className="amount">
        {formatRub(event.amountKopecks)}
      </span>
    ),
    event.rating === null ? null : (
      <span key="rating">
        <span aria-hidden="true">{stars(event.rating)} </span>
        {ratingText(event.rating)}
      </span>
    ),
    event.contact === null ? null : <Contact key="contact" contact={event.contact} />,
  ].filter((item) => item !== null);

  return (
    <li className="timeline__item">
      <div className="timeline__head">
        <span className="timeline__date">
          {formatShortDate(event.occurredOn as `${number}-${number}-${number}`, today)}
        </span>
        <span>Записал(а): {nameOf(event.authorId)}</span>
      </div>
      <p className="timeline__text">{event.text}</p>
      {extras.length > 0 ? <div className="timeline__facts">{extras}</div> : null}
      {abilities.edit || abilities.trash ? (
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
      <ObjectError error={quick.error} action="event" />
    </li>
  );
}

function AutoItem({ card, item }: { card: ObjectCard; item: AutoEvent }) {
  const { me } = useHousehold();
  const nameOf = usePersonName();
  const fieldName =
    item.fieldId === undefined
      ? null
      : (card.fields.find((field) => field.id === item.fieldId)?.name ?? null);
  return (
    <li className="timeline__item">
      <div className="timeline__head">
        <span>{formatMoment(item.at, me.timeZone)}</span>
        {item.actorId ? <span>{nameOf(item.actorId)}</span> : null}
      </div>
      <p className="timeline__auto">{describeAuto(item, fieldName)}</p>
    </li>
  );
}

/** Показание счётчика в ленте: какой счётчик, значения по зонам и расход (OBJ-3, UTIL-4). */
function ReadingItem({ item, meters }: { item: ReadingEvent; meters: readonly MeterListItem[] }) {
  const { me } = useHousehold();
  const nameOf = usePersonName();
  const meter = meters.find((candidate) => candidate.id === item.meterId);
  const zones = meter?.data.zones ?? item.values.map(() => 'Основная');
  const unit = meter === undefined ? '' : (meter.data.unit ?? RESOURCE_UNITS[meter.data.resource]);
  const show = (value: string, index: number) => {
    const zone = zoneLabel(zones, index);
    const text = unit === '' ? showDecimal(value) : showWithUnit(value, unit);
    return zone === null ? text : `${zone} ${text}`;
  };
  return (
    <li className="timeline__item">
      <div className="timeline__head">
        <span className="timeline__date">
          {formatShortDate(item.occurredOn as DateOnly, todayIn(me.timeZone))}
        </span>
        {item.actorId ? <span>Записал(а): {nameOf(item.actorId)}</span> : null}
      </div>
      <p className="timeline__text">Показание: {meter?.title ?? 'счётчик'}</p>
      <div className="timeline__facts">
        <span>{item.values.map(show).join(' · ')}</span>
        {item.consumption === null ? (
          <span>начальное показание</span>
        ) : (
          <span>Расход: {item.consumption.map(show).join(' · ')}</span>
        )}
      </div>
    </li>
  );
}
/** Взаимодействие контакта с объектом (CONT-4): вид, кто, что было и сколько стоило. */
function InteractionItem({ item }: { item: InteractionEvent }) {
  const { me } = useHousehold();
  return (
    <li className="timeline__item">
      <div className="timeline__head">
        <span className="timeline__date">
          {formatShortDate(item.occurredOn as DateOnly, todayIn(me.timeZone))}
        </span>
        <span>{KIND_LABELS[item.kind]}</span>
      </div>
      <p className="timeline__text">{item.text}</p>
      <div className="timeline__facts">
        <span>
          Контакт:{' '}
          <Link className="text-button" to={`/people/contacts/${item.contactId}`}>
            {item.contactTitle ?? 'открыть'}
          </Link>
        </span>
        {item.amountCents === null ? null : (
          <span className="amount">{formatRub(item.amountCents)}</span>
        )}
        {item.callAgain === null ? null : (
          <span>{item.callAgain ? 'Звать снова: да' : 'Звать снова: нет'}</span>
        )}
      </div>
    </li>
  );
}

/** «Лента» (OBJ-3): автоматические события и ручные записи объекта по дате, новые сверху. */
export function ObjectTimeline() {
  const { card, abilities } = useObjectContext();
  const { me } = useHousehold();
  const toast = useToast();
  const refresh = useRefreshObjects();
  const query = useTimeline(card.id);
  const meters = useMeters(card.id, 'all', card.objectType === 'property');
  const adding = useAction();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const viewer = viewerOf(me);
  const trashed = card.deletedAt !== null;
  const canAdd = abilities.edit && !trashed;

  function add(values: EventInput) {
    void adding.run(async () => {
      await createEvent(card.id, values);
      await refresh();
      setFormOpen(false);
      toast.show({ message: 'Событие добавлено' });
    });
  }

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      {canAdd ? (
        formOpen ? (
          <section className="section" aria-label="Новое событие">
            <EventForm
              draft={{
                occurredOn: todayIn(me.timeZone),
                text: '',
                amountKopecks: null,
                rating: null,
              }}
              submitLabel="Добавить"
              pendingLabel="Добавляем…"
              state={adding}
              onSubmit={add}
              onCancel={() => {
                adding.setError(null);
                setFormOpen(false);
              }}
            />
          </section>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
          >
            <Plus size={20} weight="bold" aria-hidden />
            Добавить событие
          </button>
        )
      ) : null}

      {query.isPending ? <Notice>Загружаем ленту…</Notice> : null}
      {query.isError && items.length === 0 ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку ленты
          </button>
        </>
      ) : null}
      {query.data && items.length === 0 ? (
        <EmptyState title="В ленте пока пусто">
          <p>Здесь появятся изменения объекта и ваши записи о нём: ремонт, оплаты, звонки.</p>
        </EmptyState>
      ) : null}
      {items.length > 0 ? (
        <ul className="timeline" aria-label="Лента объекта">
          {items.map((item) =>
            item.source === 'manual' ? (
              <ManualItem
                key={`${item.source}:${item.id}`}
                card={card}
                event={item}
                abilities={eventAbilities(viewer, card, item, canAdd)}
                editing={editingId === item.id}
                onEdit={() => {
                  setFormOpen(false);
                  setEditingId(item.id);
                }}
                onClose={() => setEditingId(null)}
              />
            ) : item.source === 'reading' ? (
              <ReadingItem key={`reading:${item.id}`} item={item} meters={meters.data ?? []} />
            ) : item.source === 'interaction' ? (
              <InteractionItem key={`interaction:${item.id}`} item={item} />
            ) : (
              <AutoItem key={`${item.source}:${item.id}`} card={card} item={item} />
            ),
          )}
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
      {query.isError && items.length > 0 ? <ObjectError error={query.error} action="load" /> : null}
    </>
  );
}
