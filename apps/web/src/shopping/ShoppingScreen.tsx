import { canRestore, canTrash, canWrite } from '@homecrm/shared';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { useScope } from '../access/ScopeContext.tsx';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { AiCapture, useAiStatus } from '../ai/AiCapture.tsx';
import { ApiError, errorMessage } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHouseNames } from '../deadlines/useHouseNames.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import {
  creatableVisibilities,
  factsOf,
  newPlacement,
  viewerOf,
  visibilityOf,
} from '../notes/abilities.ts';
import { listScopeOf } from '../notes/queries.ts';
import { uuid } from '../offline/store.ts';
import { AddActionContext } from '../shell/AddAction.tsx';
import { Link, useNavigate } from '../shell/motion.tsx';
import { FeedPage, useFeedPane, useFeedSummary } from '../tasks/feed-pane.tsx';
import { RecordPicker } from '../tasks/options.tsx';
import { TaskTabs } from '../tasks/TaskTabs.tsx';
import { CheckToggle } from '../ui/CheckToggle.tsx';
import { countWord } from '../ui/format.ts';
import { groupBy } from '../ui/groupBy.ts';
import { MotionGroups } from '../ui/MotionGroups.tsx';
import { MotionList } from '../ui/MotionList.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { DictationButton, DictationStatus, useDictation } from '../voice/Dictation.tsx';
import { appendDictation } from '../voice/recognition.ts';
import { dictatedDrafts, type ShoppingDraft } from '../voice/shopping-dictation.ts';
import {
  createShopping,
  fetchShopping,
  fetchShoppingCard,
  patchShopping,
  type ShoppingCard,
  shoppingAction,
} from './api.ts';
import { alreadyListed } from './duplicates.ts';
import { draftsMessage, ShoppingDrafts } from './ShoppingDrafts.tsx';
import { ShoppingLinks } from './ShoppingLinks.tsx';
import '../tasks/today.css';
import '../styles/studio2-lists.css';

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
  const pane = useFeedPane();
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const toast = useToast();
  const [params] = useSearchParams();
  const [house, setHouse] = useState(() =>
    me.roles.some((role) => role.householdId === params.get('householdId'))
      ? (params.get('householdId') ?? '')
      : (householdId ?? ''),
  );
  const [trash, setTrash] = useState(false);
  const houseNames = useHouseNames({
    scope: listScopeOf(scope),
    view: 'mine',
    ...(house ? { householdId: house } : {}),
  });
  const [title, setTitle] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [listChoice, setListChoice] = useState<'household' | 'personal'>(
    scope === 'personal' ? 'personal' : 'household',
  );
  const selectedList =
    scope === 'all' ? listChoice : scope === 'personal' ? 'personal' : 'household';
  const [place, setPlace] = useState<Visibility>(
    scope === 'personal' || !house ? 'personal' : 'household',
  );
  const [details, setDetails] = useState(false);
  const [drafts, setDrafts] = useState<ShoppingDraft[] | null>(null);
  const ai = useAiStatus(house || null);
  // Надиктованная строка без «Разобрать» (отказ от ИИ, сбой, предел) делится на позиции как в SHOP-4.
  const [dictated, setDictated] = useState(false);
  // SHOP-4: надиктованное сначала показывается черновиками, ничего не добавляется само.
  // Фраза без позиций («и», «, ,», тишина) не открывает пустой лист, а просит повторить.
  const dictation = useDictation((text) => {
    // D25: при включённом ИИ фраза остаётся в строке до явного «Разобрать» и согласия.
    if (ai.data?.enabled) {
      if (!text.trim()) return 'Ничего не расслышали. Скажите ещё раз.';
      setTitle((current) => appendDictation(current, text));
      setDictated(true);
      setDuplicate(false);
      return undefined;
    }
    const result = dictatedDrafts(text);
    if ('error' in result) return result.error;
    setDrafts(result.drafts);
    return undefined;
  });
  const input = useRef<HTMLInputElement>(null);
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
  useFeedSummary(
    query.data && !query.error
      ? all.filter((card) => !card.boughtAt && card.spaceKind === selectedList).length
      : undefined,
    query.error
      ? 'Не удалось загрузить покупки'
      : query.isPending
        ? 'Загружаем…'
        : selectedList === 'personal'
          ? 'в личном списке'
          : 'в общем списке',
    !query.isPending,
    house || null,
  );
  const viewer = viewerOf(me);
  const options = creatableVisibilities(viewer, house || null, 'shopping_item');
  function add(event: FormEvent) {
    event.preventDefault();
    if (state.disabled) return;
    const value = title.trim();
    if (!value) return;
    if (dictated || value.length > 200) {
      const result = dictatedDrafts(value);
      if (!('error' in result)) {
        setDrafts(result.drafts);
        setTitle('');
        setDictated(false);
        return;
      }
    }
    const placement = newPlacement(place, house || null);
    const body = { title: value, ...(placement ? { placement } : {}) };
    void state.run(async () => {
      if (await alreadyListed(value, place, house || null)) {
        setDuplicate(true);
        return;
      }
      await createShopping({ ...body, idempotencyKey: key(body) });
      // Незавершённое первое чтение содержит снимок до POST; invalidate переиспользует его.
      await client.cancelQueries({ queryKey: ['shopping', account] });
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
      <MotionList className="task-list" version={items.map((card) => card.id).join(',')}>
        {items.map((card) => (
          <li
            key={card.id}
            data-motion-key={card.id}
            className={card.boughtAt ? 'task-row task-row--done' : 'task-row'}
          >
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
                {[card.data.note, card.data.store, card.boughtAt ? 'Куплено' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Link>
            {card.quantity ? <span className="shopping-quantity">{card.quantity}</span> : null}
            <AccessBadge visibility={visibilityOf(card)} />
          </li>
        ))}
      </MotionList>
    );
  }
  function list(items: ShoppingCard[]) {
    const open = items.filter((card) => !card.boughtAt);
    const bought = items.filter((card) => !!card.boughtAt);
    return (
      <MotionGroups version={items.map((card) => card.id + String(!!card.boughtAt)).join(',')}>
        {open.length ? (
          [...groupBy(open, (card) => card.data.category || card.data.store || 'Без магазина')].map(
            ([category, items]) => (
              <Section
                key={category}
                motionKey={category}
                title={category}
                aside={<span className="muted">{items.length}</span>}
              >
                {rows(items)}
              </Section>
            ),
          )
        ) : (
          <p className="muted">{bought.length ? 'Всё куплено' : 'Добавьте первую покупку'}</p>
        )}
        {bought.length ? (
          <details className="shopping-bought">
            <summary>Куплено · {bought.length} · уберём через 7 дней</summary>
            {rows(bought)}
            <p className="muted">
              Через 7 дней купленное перейдёт в корзину. В корзине хранится ещё 30 дней.
            </p>
          </details>
        ) : null}
      </MotionGroups>
    );
  }
  return (
    <AddActionContext.Provider
      value={() => {
        setTrash(false);
        requestAnimationFrame(() => input.current?.focus());
      }}
    >
      <FeedPage
        title="Покупки"
        className="studio-list-page shopping-page"
        heading={
          <div className="studio-list-hero">
            <h1 className="visually-hidden">Покупки</h1>
            <fieldset className="studio-segments" aria-label="Список покупок">
              <button
                type="button"
                aria-pressed={selectedList === 'household'}
                disabled={scope === 'personal'}
                onClick={() => {
                  setListChoice('household');
                  setPlace('household');
                }}
              >
                Вся семья
              </button>
              <button
                type="button"
                aria-pressed={selectedList === 'personal'}
                disabled={scope === 'shared'}
                onClick={() => {
                  setListChoice('personal');
                  setPlace('personal');
                }}
              >
                Только я
              </button>
            </fieldset>
            {query.data && !query.error && !query.hasNextPage ? (
              <p className="studio-list-summary">
                {selectedList === 'personal' ? 'В личном списке' : 'В общем списке'}{' '}
                {countWord(
                  all.filter((card) => !card.boughtAt && card.spaceKind === selectedList).length,
                  ['покупка', 'покупки', 'покупок'],
                )}
              </p>
            ) : null}
          </div>
        }
      >
        <div className="studio-panel studio-list-panel">
          {!pane ? (
            <TaskTabs houseQuery={house && house !== householdId ? `?householdId=${house}` : ''} />
          ) : null}
          <div className="task-feed-content">
            {pane ? (
              <fieldset className="studio-segments" aria-label="Список покупок">
                <button
                  type="button"
                  aria-pressed={selectedList === 'household'}
                  disabled={scope === 'personal'}
                  onClick={() => {
                    setListChoice('household');
                    setPlace('household');
                  }}
                >
                  Вся семья
                </button>
                <button
                  type="button"
                  aria-pressed={selectedList === 'personal'}
                  disabled={scope === 'shared'}
                  onClick={() => {
                    setListChoice('personal');
                    setPlace('personal');
                  }}
                >
                  Только я
                </button>
              </fieldset>
            ) : null}
            {me.roles.length > 1 ? (
              <label className="field">
                Дом
                <select
                  aria-label="Дом"
                  className="input"
                  value={house}
                  onChange={(event) => {
                    setHouse(event.target.value);
                    setPlace(selectedList);
                  }}
                >
                  {me.roles.map((role) => (
                    <option key={role.householdId} value={role.householdId}>
                      {houseNames(role.householdId)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!trash ? (
              <form className="shopping-quick" onSubmit={add}>
                <label className="field__label" htmlFor="shopping-quick-title">
                  Добавить одной строкой
                </label>
                <div className="shopping-quick__line voice-line">
                  <input
                    ref={input}
                    id="shopping-quick-title"
                    className="input"
                    value={title}
                    maxLength={ai.data?.enabled ? 20000 : 200}
                    placeholder="Что купить?"
                    required
                    enterKeyHint="done"
                    readOnly={state.disabled}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (!event.target.value) setDictated(false);
                      setDuplicate(false);
                    }}
                  />
                  <DictationButton dictation={dictation} />
                  <AiCapture
                    key={house}
                    text={title}
                    house={house || null}
                    place={place}
                    beforeExtract={dictation.abort}
                  />
                  <button type="submit" className="btn btn--primary" disabled={state.disabled}>
                    Добавить
                  </button>
                </div>
                <DictationStatus dictation={dictation} />
                {duplicate ? <p role="status">Уже в списке</p> : null}
                <details className="studio-list-options">
                  <summary>Параметры покупки</summary>
                  <VisibilityPicker
                    value={options.includes(place) ? place : 'personal'}
                    options={options}
                    onChange={setPlace}
                  />
                  <button type="button" className="text-button" onClick={() => setDetails(true)}>
                    Количество, заметка и связи
                  </button>
                </details>
                <ShoppingError error={state.error} />
              </form>
            ) : null}
            {query.isPending ? (
              <Notice>Загружаем покупки…</Notice>
            ) : query.isError ? (
              <>
                <ShoppingError error={query.error} />
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={() => void query.refetch()}
                >
                  Повторить загрузку
                </button>
              </>
            ) : all.length === 0 ? (
              <p className="muted">{trash ? 'Удалённых покупок нет' : 'Добавьте первую покупку'}</p>
            ) : (
              <>
                {scope !== 'personal' && all.some((card) => card.spaceKind === 'household') ? (
                  <section aria-label="Общий список">
                    {list(all.filter((card) => card.spaceKind === 'household'))}
                  </section>
                ) : null}
                {scope !== 'shared' && all.some((card) => card.spaceKind === 'personal') ? (
                  <section aria-label="Мой список">
                    {list(all.filter((card) => card.spaceKind === 'personal'))}
                  </section>
                ) : null}
              </>
            )}
            <ShoppingError error={action.error} />
            <details className="studio-list-options shopping-tools">
              <summary>Управление списком</summary>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-pressed={!trash}
                  onClick={() => setTrash(false)}
                >
                  Купить
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-pressed={trash}
                  onClick={() => setTrash(true)}
                >
                  Удалённые покупки
                </button>
              </div>
            </details>
            {state.disabled && !state.pending ? (
              <p className="muted">Без сети покупки доступны только для чтения.</p>
            ) : null}
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
            {drafts ? (
              <ShoppingDrafts
                drafts={drafts}
                place={place}
                house={house || null}
                onClose={() => {
                  dictation.abort();
                  setDrafts(null);
                }}
                onAdded={async (added, duplicates) => {
                  await client.cancelQueries({ queryKey: ['shopping', account] });
                  await refresh();
                  toast.show({ message: draftsMessage(added, duplicates) });
                }}
              />
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
          </div>
        </div>
      </FeedPage>
    </AddActionContext.Provider>
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

export function ShoppingEditor({
  card,
  house,
  initialTitle = '',
  initialQuantity = '',
  notice,
  onCreated,
  onClose,
  onSaved,
}: {
  card?: ShoppingCard;
  house: string | null;
  initialTitle?: string;
  initialQuantity?: string;
  notice?: string;
  onCreated?: (id: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { me } = useHousehold();
  const state = useAction();
  const key = useOperationKey();
  const [title, setTitle] = useState(card?.title ?? initialTitle);
  const [quantity, setQuantity] = useState(card?.quantity ?? initialQuantity);
  const createdId = useRef<string | null>(null);
  const [note, setNote] = useState(card?.data.note ?? '');
  const [store, setStore] = useState(card?.data.store ?? '');
  const [category, setCategory] = useState(card?.data.category ?? '');
  const [object, setObject] = useState('');
  const [task, setTask] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(
    card ? visibilityOf(card) : house ? 'household' : 'personal',
  );
  const [conflict, setConflict] = useState<ShoppingCard | null>(null);
  const [duplicate, setDuplicate] = useState(false);
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
          if (!createdId.current && (await alreadyListed(body.title, visibility, house))) {
            setDuplicate(true);
            return;
          }
          const placement = newPlacement(visibility, house);
          const created = createdId.current
            ? { id: createdId.current }
            : await createShopping({
                ...body,
                ...(placement ? { placement } : {}),
                links: [
                  ...(object ? [{ type: 'object' as const, id: object }] : []),
                  ...(task ? [{ type: 'task' as const, id: task }] : []),
                ],
                idempotencyKey: key({ body, placement, object, task }),
              });
          if (onCreated) {
            createdId.current = created.id;
            await onCreated(created.id);
          }
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
      {notice ? <Notice>{notice}</Notice> : null}
      <form className="auth-form" onSubmit={save}>
        <label>
          Название
          <input
            className="input"
            value={title}
            required
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              setDuplicate(false);
            }}
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
        {duplicate ? <p role="status">Уже в списке</p> : null}
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
