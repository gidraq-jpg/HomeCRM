import { canRestore, canTrash, canWrite } from '@homecrm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { factsOf, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { ListSkeleton } from '../ui/ListSkeleton.tsx';
import { useNavigate } from '../ui/navigation.tsx';
import { Page } from '../ui/Page.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { fetchShoppingCard, shoppingAction } from './api.ts';
import { ShoppingEditor } from './ShoppingEditor.tsx';
import { ShoppingError } from './ShoppingError.tsx';
import { ShoppingLinks } from './ShoppingLinks.tsx';

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
          <ListSkeleton label="Загружаем покупку…" />
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
