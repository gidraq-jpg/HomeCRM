import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import type { Visibility } from '../access/visibility.ts';
import { Notice } from '../auth/components.tsx';
import { useHouseNames } from '../deadlines/useHouseNames.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, viewerOf } from '../notes/abilities.ts';
import { listScopeOf } from '../notes/queries.ts';
import { AddActionContext } from '../shell/AddAction.tsx';
import { FeedPage, useFeedPane } from '../tasks/feed-pane.tsx';
import { TaskTabs } from '../tasks/TaskTabs.tsx';
import { countWord } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import { draftsMessage, ShoppingDrafts } from './ShoppingDrafts.tsx';
import { ShoppingEditor } from './ShoppingEditor.tsx';
import { ShoppingError } from './ShoppingError.tsx';
import { ShoppingQuickAdd } from './ShoppingQuickAdd.tsx';
import { ShoppingList } from './ShoppingRows.tsx';
import { initialHouse, openCount, selectedListOf } from './shopping-list.ts';
import { useShoppingFeed, useShoppingQuickAdd, useShoppingRowActions } from './useShopping.ts';

// Карточка покупки и редактор живут в своих файлах; отсюда их берут раздел «Ещё» и «Входящие»,
// чтобы стили списка покупок грузились вместе с ними, как прежде.
export { ShoppingCardScreen } from './ShoppingCardScreen.tsx';
export { ShoppingEditor } from './ShoppingEditor.tsx';

import '../tasks/today.css';
import '../styles/studio2-lists.css';
import './shopping-input.css';

export function ShoppingScreen() {
  const pane = useFeedPane();
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const toast = useToast();
  const [params] = useSearchParams();
  const [house, setHouse] = useState(() =>
    initialHouse(me.roles, params.get('householdId'), householdId),
  );
  const [trash, setTrash] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const houseNames = useHouseNames({
    scope: listScopeOf(scope),
    view: 'mine',
    ...(house ? { householdId: house } : {}),
  });
  const [listChoice, setListChoice] = useState<'household' | 'personal'>(
    scope === 'personal' || !house ? 'personal' : 'household',
  );
  const selectedList = selectedListOf(house, scope, listChoice);
  const [place, setPlace] = useState<Visibility>(
    scope === 'personal' || !house ? 'personal' : 'household',
  );
  const [details, setDetails] = useState(false);
  const { query, all, refresh, settle } = useShoppingFeed(scope, house, trash, selectedList);
  const quickAdd = useShoppingQuickAdd({ house, place, refresh, settle });
  const { title, setTitle, drafts, setDrafts, dictation, state } = quickAdd;
  const input = useRef<HTMLTextAreaElement>(null);
  const quick = useRef<HTMLFormElement>(null);
  const { action, toggle, step } = useShoppingRowActions(refresh);
  const viewer = viewerOf(me);
  const options = creatableVisibilities(viewer, house || null, 'shopping_item');
  const context = { viewer, trash, action, openStep, setOpenStep, toggle, step };
  return (
    <AddActionContext.Provider
      value={() => {
        setTrash(false);
        requestAnimationFrame(() => {
          // Заголовок строки добавления не прячется под липкие вкладки.
          quick.current?.scrollIntoView({ block: 'start' });
          input.current?.focus({ preventScroll: true });
        });
      }}
    >
      <FeedPage
        title="Покупки"
        className="studio-list-page shopping-page"
        heading={
          <div className="studio-list-hero">
            <h1 className="visually-hidden">Покупки</h1>
            {query.data && !query.error && !query.hasNextPage ? (
              <p className="studio-list-summary">
                {selectedList === 'personal' ? 'В личном списке' : 'В общем списке'}{' '}
                {countWord(openCount(all, selectedList), ['покупка', 'покупки', 'покупок'])}
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
              <ShoppingQuickAdd
                quick={quick}
                input={input}
                quickAdd={quickAdd}
                house={house}
                options={options}
                place={place}
                setPlace={setPlace}
                onDetails={() => setDetails(true)}
              />
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
                    <ShoppingList
                      items={all.filter((card) => card.spaceKind === 'household')}
                      context={context}
                    />
                  </section>
                ) : null}
                {scope !== 'shared' && all.some((card) => card.spaceKind === 'personal') ? (
                  <section aria-label="Мой список">
                    <ShoppingList
                      items={all.filter((card) => card.spaceKind === 'personal')}
                      context={context}
                    />
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
                  await settle();
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
