import { canWrite } from '@homecrm/shared';
import type { useAction } from '../auth/components.tsx';
import { factsOf, type viewerOf } from '../notes/abilities.ts';
import { CheckToggle } from '../ui/CheckToggle.tsx';
import { MotionGroups } from '../ui/MotionGroups.tsx';
import { MotionList } from '../ui/MotionList.tsx';
import { Link } from '../ui/navigation.tsx';
import { Section } from '../ui/Page.tsx';
import type { ShoppingCard } from './api.ts';
import { quantityStep } from './quantity.ts';
import { rowMeta, shownQuantity, splitShopping } from './shopping-list.ts';

/** Что нужно строкам списка: кто смотрит, корзина ли это, открытый шаг количества и действия. */
export type ShoppingRowsContext = {
  viewer: ReturnType<typeof viewerOf>;
  trash: boolean;
  action: ReturnType<typeof useAction>;
  openStep: string | null;
  setOpenStep: (id: string | null) => void;
  toggle: (card: ShoppingCard) => void;
  step: (card: ShoppingCard, delta: number) => void;
};

function ShoppingRows({ items, context }: { items: ShoppingCard[]; context: ShoppingRowsContext }) {
  const { viewer, trash, action, openStep, setOpenStep, toggle, step } = context;
  return (
    <MotionList className="task-list" version={items.map((card) => card.id).join(',')}>
      {items.map((card) => {
        const writable =
          !action.disabled && canWrite(viewer, factsOf(card, viewer, 'shopping_item'));
        const adjustable = !trash && !card.boughtAt && writable;
        const quantity = shownQuantity(card, adjustable);
        const stepping = adjustable && openStep === card.id;
        // Доступ подписывается только исключением: «Взрослые».
        const meta = rowMeta(card);
        return (
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
            ) : (
              <span className="shopping-row__spacer" aria-hidden />
            )}
            <Link className="task-row__body shopping-row-link" to={`/more/shopping/${card.id}`}>
              <span className="row__title">{card.title}</span>
              {meta ? <span className="row__meta">{meta}</span> : null}
            </Link>
            {quantity ? (
              adjustable ? (
                <button
                  type="button"
                  className="shopping-quantity shopping-quantity--button"
                  aria-expanded={stepping}
                  aria-label={`Количество ${quantity}, изменить: ${card.title}`}
                  onClick={() => setOpenStep(stepping ? null : card.id)}
                >
                  ×{quantity}
                </button>
              ) : (
                <span className="shopping-quantity">×{quantity}</span>
              )
            ) : null}
            {stepping ? (
              <div className="shopping-steps">
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-label={`Уменьшить количество: ${card.title}`}
                  disabled={!quantityStep(card.quantity, -1)}
                  onClick={() => step(card, -1)}
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-label={`Увеличить количество: ${card.title}`}
                  disabled={!quantityStep(card.quantity, 1)}
                  onClick={() => step(card, 1)}
                >
                  +
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </MotionList>
  );
}

/** Один список покупок: некупленное по категориям и свёрнутое «Куплено». */
export function ShoppingList({
  items,
  context,
}: {
  items: ShoppingCard[];
  context: ShoppingRowsContext;
}) {
  const { groups, bought } = splitShopping(items);
  return (
    <MotionGroups version={items.map((card) => card.id + String(!!card.boughtAt)).join(',')}>
      {groups.length ? (
        groups.map(([category, items]) => (
          <Section
            key={category}
            motionKey={category}
            title={category}
            aside={<span className="muted">{items.length}</span>}
          >
            <ShoppingRows items={items} context={context} />
          </Section>
        ))
      ) : (
        <p className="muted">{bought.length ? 'Всё куплено' : 'Добавьте первую покупку'}</p>
      )}
      {bought.length ? (
        <details className="shopping-bought">
          <summary>Куплено · {bought.length} · уберём через 7 дней</summary>
          <ShoppingRows items={bought} context={context} />
          <p className="muted">
            Через 7 дней купленное перейдёт в корзину. В корзине хранится ещё 30 дней.
          </p>
        </details>
      ) : null}
    </MotionGroups>
  );
}
