import { X } from '@phosphor-icons/react';
import { type FormEvent, useRef, useState } from 'react';
import type { Visibility } from '../access/visibility.ts';
import { ErrorNotice, useAction } from '../auth/components.tsx';
import { newPlacement } from '../notes/abilities.ts';
import { uuid } from '../offline/store.ts';
import { countWord, plural } from '../ui/format.ts';
import { Sheet } from '../ui/Sheet.tsx';
import type { ShoppingDraft } from '../voice/shopping-dictation.ts';
import { createShopping } from './api.ts';
import { listedNames, shoppingName } from './duplicates.ts';

type Row = ShoppingDraft & { id: string; duplicate?: boolean };

const POSITIONS = ['позицию', 'позиции', 'позиций'] as const;
const ADDED = ['позиция', 'позиции', 'позиций'] as const;

/**
 * SHOP-4: черновики надиктованных покупок. Человек правит название и количество, убирает
 * лишнее и добавляет всё одним нажатием; дубли проверяются так же, как у строки ввода.
 */
export function ShoppingDrafts({
  drafts,
  place,
  house,
  onClose,
  onAdded,
}: {
  drafts: ShoppingDraft[];
  place: Visibility;
  house: string | null;
  onClose: () => void;
  onAdded: (added: number, duplicates: number) => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>(() => drafts.map((draft) => ({ ...draft, id: uuid() })));
  const state = useAction();
  // Повтор неизменённой позиции после сбоя сети идёт с тем же ключом операции.
  const keys = useRef(new Map<string, { body: string; key: string }>());
  const ready = rows.filter((row) => row.title.trim());
  function keyOf(id: string, body: unknown) {
    const text = JSON.stringify(body);
    const known = keys.current.get(id);
    if (known?.body === text) return known.key;
    const key = uuid();
    keys.current.set(id, { body: text, key });
    return key;
  }
  function update(id: string, change: Partial<ShoppingDraft>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change, duplicate: false } : row)),
    );
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (state.disabled || ready.length === 0) return;
    void state.run(async () => {
      const placement = newPlacement(place, house);
      // Список для проверки дублей — один раз на нажатие; добавленное дальше пополняет `seen`.
      const listed = await listedNames(place, house);
      const seen = new Set<string>();
      const duplicates = new Set<string>();
      const added = new Set<string>();
      try {
        for (const row of ready) {
          const title = row.title.trim();
          const name = shoppingName(title);
          if (seen.has(name) || listed.has(name)) {
            duplicates.add(row.id);
            continue;
          }
          seen.add(name);
          const body = {
            title,
            quantity: row.quantity?.trim() || null,
            ...(placement ? { placement } : {}),
          };
          await createShopping({ ...body, idempotencyKey: keyOf(row.id, body) });
          added.add(row.id);
        }
      } finally {
        // Добавленное убираем из черновиков и при сбое: повтор не создаст его второй раз.
        setRows((current) =>
          current
            .filter((row) => !added.has(row.id))
            .map((row) => ({ ...row, duplicate: duplicates.has(row.id) })),
        );
      }
      if (added.size || duplicates.size) await onAdded(added.size, duplicates.size);
      if (duplicates.size === 0) onClose();
    });
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !state.pending) onClose();
      }}
      title="Надиктованные покупки"
      description="Проверьте позиции: название и количество можно поправить"
    >
      <form onSubmit={submit}>
        {rows.length ? (
          <ul className="voice-drafts" aria-label="Черновики покупок">
            {rows.map((row, index) => (
              <li key={row.id} className="voice-draft">
                <label>
                  <span>
                    Название<span className="visually-hidden"> позиции {index + 1}</span>
                  </span>
                  <input
                    className="input"
                    value={row.title}
                    aria-label={`Название позиции ${index + 1}`}
                    aria-describedby={
                      row.titleConfident === false ? `draft-title-${row.id}` : undefined
                    }
                    maxLength={200}
                    onChange={(event) => update(row.id, { title: event.target.value })}
                  />
                  {row.titleConfident === false ? (
                    <small className="muted" id={`draft-title-${row.id}`}>
                      ИИ не уверен: проверьте название
                    </small>
                  ) : null}
                </label>
                <label>
                  <span>
                    Количество<span className="visually-hidden"> позиции {index + 1}</span>
                  </span>
                  <input
                    className="input"
                    value={row.quantity ?? ''}
                    aria-label={`Количество позиции ${index + 1}`}
                    aria-describedby={
                      row.quantityConfident === false ? `draft-quantity-${row.id}` : undefined
                    }
                    maxLength={200}
                    onChange={(event) => update(row.id, { quantity: event.target.value })}
                  />
                  {row.quantityConfident === false ? (
                    <small className="muted" id={`draft-quantity-${row.id}`}>
                      ИИ не уверен: проверьте количество
                    </small>
                  ) : null}
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Убрать позицию: ${row.title.trim() || index + 1}`}
                  onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                >
                  <X size={20} aria-hidden />
                </button>
                {row.duplicate ? <p className="voice-draft__duplicate">Уже в списке</p> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Позиций не осталось</p>
        )}
        <ErrorNotice error={state.error} />
        {state.disabled && !state.pending ? (
          <p className="muted">Без сети покупки доступны только для чтения.</p>
        ) : null}
        <div className="voice-drafts-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={state.disabled || ready.length === 0}
          >
            {state.pending ? 'Добавляем…' : `Добавить ${countWord(ready.length, POSITIONS)}`}
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={state.pending}
            onClick={onClose}
          >
            Отмена
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** «Добавлены 3 позиции», «1 уже в списке» — для всплывающего сообщения. */
export function draftsMessage(added: number, duplicates: number) {
  const parts: string[] = [];
  if (added)
    parts.push(
      `${plural(added, ['Добавлена', 'Добавлены', 'Добавлено'])} ${countWord(added, ADDED)}`,
    );
  if (duplicates) parts.push(`${parts.length ? 'у' : 'У'}же в списке: ${duplicates}`);
  return parts.join(', ');
}
