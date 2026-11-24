import { type FormEvent, useRef, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { ApiError } from '../auth/api.ts';
import { Notice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, newPlacement, viewerOf, visibilityOf } from '../notes/abilities.ts';
import { RecordPicker } from '../tasks/options.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { createShopping, fetchShoppingCard, patchShopping, type ShoppingCard } from './api.ts';
import { alreadyListed } from './duplicates.ts';
import { ShoppingError } from './ShoppingError.tsx';

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
