import { canRestore, canTrash, canWrite } from '@homecrm/shared';
import { Plus, ShoppingCart } from '@phosphor-icons/react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { ApiError, errorMessage } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import {
  creatableVisibilities,
  factsOf,
  newPlacement,
  viewerOf,
  visibilityOf,
} from '../notes/abilities.ts';
import { uuid } from '../offline/store.ts';
import { RecordPicker } from '../tasks/options.tsx';
import { CheckToggle } from '../ui/CheckToggle.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import {
  createShopping,
  fetchShopping,
  fetchShoppingCard,
  patchShopping,
  type ShoppingCard,
  shoppingAction,
} from './api.ts';
import { ShoppingLinks } from './ShoppingLinks.tsx';

function ShoppingError({ error }: { error: unknown }) {
  if (!error) return null;
  const text =
    error instanceof ApiError && error.status === 404
      ? 'Покупка или связанная запись недоступна. Обновите список.'
      : error instanceof ApiError && error.status === 409
        ? 'Позиция изменилась на другом устройстве. Ваш ввод сохранён.'
        : errorMessage(error);
  return <Notice error>{text}</Notice>;
}
export function ShoppingScreen() {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const toast = useToast();
  const [house, setHouse] = useState(householdId ?? '');
  const [trash, setTrash] = useState(false);
  const [title, setTitle] = useState('');
  const [place, setPlace] = useState<Visibility>(
    scope === 'personal' || !house ? 'personal' : 'household',
  );
  const [details, setDetails] = useState(false);
  const state = useAction();
  const action = useAction();
  const key = useOperationKey();
  const toggleKey = useOperationKey();
  const mode = scope === 'shared' ? 'household' : scope;
  const account = me.id;
  const query = useInfiniteQuery({
    queryKey: ['shopping', me.id, scope, house, trash],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchShopping(mode, house || null, trash, pageParam, signal),
    getNextPageParam: (last, pages) => (last.length >= 100 ? pages.length * 100 : undefined),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['shopping', account] });
  const all = query.data?.pages.flat() ?? [];
  const viewer = viewerOf(me);
  const options = creatableVisibilities(viewer, house || null, 'shopping_item');
  function add(event: FormEvent) {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    const placement = newPlacement(place, house || null);
    const body = { title: value, ...(placement ? { placement } : {}) };
    void state.run(async () => {
      await createShopping({ ...body, idempotencyKey: key(body) });
      setTitle('');
      await refresh();
      toast.show({ message: 'Покупка добавлена' });
    });
  }
  function toggle(card: ShoppingCard) {
    const bought = !card.boughtAt;
    const payload = { id: card.id, bought, base: card.updatedAt };
    void action.run(async () => {
      const result = await shoppingAction(card, 'bought', toggleKey(payload), bought);
      await refresh();
      toast.show({
        message: bought ? 'Куплено' : 'Вернули в список',
        action: {
          label: 'Отменить',
          onClick: () => {
            void shoppingAction(result, 'bought', uuid(), !bought)
              .then(refresh)
              .catch(() =>
                toast.show({ message: 'Не удалось отменить. Обновите список и повторите.' }),
              );
          },
        },
      });
    });
  }
  function rows(items: ShoppingCard[]) {
    return (
      <ul className="task-list">
        {items.map((card) => (
          <li key={card.id} className={card.boughtAt ? 'task-row task-row--done' : 'task-row'}>
            {!trash ? (
              <CheckToggle
                checked={!!card.boughtAt}
                label={card.title}
                disabled={
                  action.disabled || !canWrite(viewer, factsOf(card, viewer, 'shopping_item'))
                }
                onChange={() => toggle(card)}
              />
            ) : null}
            <Link className="task-row__body shopping-row-link" to={`/more/shopping/${card.id}`}>
              <span className="row__title">{card.title}</span>
              <span className="row__meta">
                {[
                  card.quantity,
                  card.data.store,
                  card.data.category,
                  card.boughtAt ? 'Куплено' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
            <AccessBadge visibility={visibilityOf(card)} />
          </li>
        ))}
      </ul>
    );
  }
  function list(items: ShoppingCard[]) {
    const open = items.filter((card) => !card.boughtAt);
    const bought = items.filter((card) => !!card.boughtAt);
    return (
      <>
        {open.length ? rows(open) : <p className="muted">В списке пусто.</p>}
        {bought.length ? (
          <details className="shopping-bought">
            <summary>Куплено · {bought.length}</summary>
            {rows(bought)}
            <p className="muted">
              Через 7 дней купленное перейдёт в корзину. В корзине хранится ещё 30 дней.
            </p>
          </details>
        ) : null}
      </>
    );
  }
  return (
    <Page title="Покупки" back={{ to: '/more', label: 'Ещё' }}>
      {me.roles.length > 1 ? (
        <label className="field">
          Дом
          <select
            aria-label="Дом"
            className="input"
            value={house}
            onChange={(event) => {
              setHouse(event.target.value);
              setPlace(scope === 'personal' ? 'personal' : 'household');
            }}
          >
            {me.roles.map((role, index) => (
              <option key={role.householdId} value={role.householdId}>
                Дом {index + 1}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="btn-row">
        <button
          type="button"
          className="btn btn--secondary"
          aria-pressed={!trash}
          onClick={() => setTrash(false)}
        >
          Список
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          aria-pressed={trash}
          onClick={() => setTrash(true)}
        >
          Корзина покупок
        </button>
      </div>
      {!trash ? (
        <form className="shopping-quick" onSubmit={add}>
          <label className="field__label" htmlFor="shopping-quick-title">
            Добавить одной строкой
          </label>
          <div className="shopping-quick__line">
            <input
              id="shopping-quick-title"
              className="input"
              value={title}
              maxLength={200}
              placeholder="Что купить?"
              required
              onChange={(event) => setTitle(event.target.value)}
            />
            <button
              type="submit"
              className="icon-button"
              aria-label="Добавить покупку"
              disabled={state.disabled}
            >
              <Plus size={22} aria-hidden />
            </button>
          </div>
          <VisibilityPicker
            value={options.includes(place) ? place : 'personal'}
            options={options}
            onChange={setPlace}
          />
          <button type="button" className="text-button" onClick={() => setDetails(true)}>
            Количество, заметка и связи
          </button>
          <ShoppingError error={state.error} />
        </form>
      ) : null}
      {query.isPending ? (
        <Notice>Загружаем покупки…</Notice>
      ) : query.isError ? (
        <>
          <ShoppingError error={query.error} />
          <button className="btn btn--secondary" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку
          </button>
        </>
      ) : all.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart size={24} aria-hidden />}
          title={trash ? 'Корзина покупок пуста' : 'В списке пусто'}
        >
          <p>
            Общий список видит вся семья, и дети тоже могут в него писать. Личный список — только
            вы.
          </p>
        </EmptyState>
      ) : (
        <>
          {scope !== 'personal' ? (
            <Section title="Общий список" aside={<span className="muted">Вся семья</span>}>
              {list(all.filter((card) => card.spaceKind === 'household'))}
            </Section>
          ) : null}
          {scope !== 'shared' ? (
            <Section title="Мой список">
              {list(all.filter((card) => card.spaceKind === 'personal'))}
            </Section>
          ) : null}
        </>
      )}
      <ShoppingError error={action.error} />
      {query.hasNextPage ? (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Ещё покупки
        </button>
      ) : null}
      {details ? (
        <ShoppingEditor
          initialTitle={title}
          house={house || null}
          onClose={() => setDetails(false)}
          onSaved={async () => {
            setDetails(false);
            setTitle('');
            await refresh();
          }}
        />
      ) : null}
    </Page>
  );
}
export function ShoppingCardScreen() {
  const { shoppingId } = useParams();
  const { me, householdId } = useHousehold();
  const client = useQueryClient();
  const navigate = useNavigate();
  const state = useAction();
  const key = useOperationKey();
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ['shopping', me.id, 'card', shoppingId],
    enabled: !!shoppingId,
    queryFn: ({ signal }) => fetchShoppingCard(shoppingId ?? '', signal),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['shopping', me.id] });
  const card = query.data;
  if (!card)
    return (
      <Page title="Покупка" back={{ to: '/more/shopping', label: 'Покупки' }}>
        {query.isPending ? (
          <Notice>Загружаем покупку…</Notice>
        ) : (
          <>
            <ShoppingError error={query.error} />
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => void query.refetch()}
            >
              Повторить
            </button>
          </>
        )}
      </Page>
    );
  const viewer = viewerOf(me);
  const facts = factsOf(card, viewer, 'shopping_item');
  function mutate(action: 'trash' | 'restore' | 'bought', bought?: boolean) {
    if (!card) return;
    const payload = { id: card.id, action, bought, base: card.updatedAt };
    void state.run(async () => {
      await shoppingAction(card, action, key(payload), bought);
      await refresh();
      if (action === 'trash') navigate('/more/shopping');
    });
  }
  return (
    <Page
      title={card.title}
      documentTitle="Покупка"
      back={{ to: '/more/shopping', label: 'Покупки' }}
    >
      <AccessBadge visibility={visibilityOf(card)} showLabel />
      {card.deletedAt ? (
        <Notice>В корзине. После восстановления позиция вернётся в некупленное.</Notice>
      ) : card.boughtAt ? (
        <Notice>Куплено. Через 7 дней перейдёт в корзину.</Notice>
      ) : null}
      <dl className="facts">
        {[
          ['Количество', card.quantity],
          ['Магазин', card.data.store],
          ['Категория', card.data.category],
        ].map(([label, value]) => (
          <div key={label} className="facts__item">
            <dt>{label}</dt>
            <dd>{value || 'Не указано'}</dd>
          </div>
        ))}
      </dl>
      <p className="shopping-note">{card.data.note || 'Заметки нет.'}</p>
      <div className="btn-row">
        {!card.deletedAt && canWrite(viewer, facts) ? (
          <>
            <button
              className="btn btn--primary"
              type="button"
              disabled={state.disabled}
              onClick={() => mutate('bought', !card.boughtAt)}
            >
              {card.boughtAt ? 'Вернуть в список' : 'Куплено'}
            </button>
            <button className="btn btn--secondary" type="button" onClick={() => setEditing(true)}>
              Править
            </button>
          </>
        ) : null}
        {!card.deletedAt && canTrash(viewer, facts) ? (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.disabled}
            onClick={() => mutate('trash')}
          >
            В корзину
          </button>
        ) : null}
        {card.deletedAt && canRestore(viewer, facts) ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={state.disabled}
            onClick={() => mutate('restore')}
          >
            Восстановить
          </button>
        ) : null}
      </div>
      <ShoppingError error={state.error} />
      <ShoppingLinks card={card} />
      {editing ? (
        <ShoppingEditor
          card={card}
          house={householdId}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

import { Sheet } from '../ui/Sheet.tsx';

function ShoppingEditor({
  card,
  house,
  initialTitle = '',
  onClose,
  onSaved,
}: {
  card?: ShoppingCard;
  house: string | null;
  initialTitle?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { me } = useHousehold();
  const state = useAction();
  const key = useOperationKey();
  const [title, setTitle] = useState(card?.title ?? initialTitle);
  const [quantity, setQuantity] = useState(card?.quantity ?? '');
  const [note, setNote] = useState(card?.data.note ?? '');
  const [store, setStore] = useState(card?.data.store ?? '');
  const [category, setCategory] = useState(card?.data.category ?? '');
  const [object, setObject] = useState('');
  const [task, setTask] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(
    card ? visibilityOf(card) : house ? 'household' : 'personal',
  );
  const [conflict, setConflict] = useState<ShoppingCard | null>(null);
  const [editBase] = useState(card?.updatedAt);
  const options = creatableVisibilities(viewerOf(me), house, 'shopping_item');
  function save(event: FormEvent) {
    event.preventDefault();
    const body = {
      title: title.trim(),
      quantity: quantity.trim() || null,
      data: { note, store, category },
    };
    void state.run(async () => {
      try {
        if (card)
          await patchShopping(card.id, {
            ...body,
            expectedUpdatedAt: conflict?.updatedAt ?? editBase,
            idempotencyKey: key({ ...body, base: conflict?.updatedAt ?? editBase }),
          });
        else {
          const placement = newPlacement(visibility, house);
          await createShopping({
            ...body,
            ...(placement ? { placement } : {}),
            links: [
              ...(object ? [{ type: 'object' as const, id: object }] : []),
              ...(task ? [{ type: 'task' as const, id: task }] : []),
            ],
            idempotencyKey: key({ body, placement, object, task }),
          });
        }
      } catch (error) {
        if (card && error instanceof ApiError && error.status === 409) {
          setConflict(await fetchShoppingCard(card.id));
          throw error;
        }
        throw error;
      }
      await onSaved();
    });
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) onClose();
      }}
      title={card ? 'Править покупку' : 'Добавить покупку'}
      description="Количество, заметка, магазин и категория"
    >
      <form className="auth-form" onSubmit={save}>
        <label>
          Название
          <input
            className="input"
            value={title}
            required
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Количество
          <input
            className="input"
            value={quantity}
            maxLength={200}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <label>
          Заметка
          <textarea
            className="input"
            value={note}
            maxLength={10000}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <label>
          Магазин
          <input
            className="input"
            value={store}
            maxLength={200}
            onChange={(e) => setStore(e.target.value)}
          />
        </label>
        <label>
          Категория
          <input
            className="input"
            value={category}
            maxLength={200}
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        {!card ? (
          <>
            <RecordPicker
              kind="object"
              label="Связь с объектом"
              value={object}
              onChange={setObject}
            />
            <RecordPicker kind="task" label="Связь с делом" value={task} onChange={setTask} />
            <VisibilityPicker
              value={options.includes(visibility) ? visibility : 'personal'}
              options={options}
              onChange={setVisibility}
            />
          </>
        ) : null}
        {conflict ? (
          <Notice>
            Сервер: {conflict.title}; {conflict.quantity}; {conflict.data.note}. Следующее
            сохранение осознанно применит вашу правку к показанной версии.
          </Notice>
        ) : null}
        <ShoppingError error={state.error} />
        <button className="btn btn--primary" type="submit" disabled={state.disabled}>
          {state.pending ? 'Сохраняем…' : conflict ? 'Применить мою правку' : 'Сохранить'}
        </button>
        <button className="btn btn--secondary" type="button" onClick={onClose}>
          Отмена
        </button>
      </form>
    </Sheet>
  );
}
