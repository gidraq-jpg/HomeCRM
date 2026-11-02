import { type AutoDraft, TaskFields } from '@homecrm/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { VisibilityPicker } from '../access/VisibilityPicker.tsx';
import type { Visibility } from '../access/visibility.ts';
import { ApiError } from '../auth/api.ts';
import { ErrorNotice, useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { creatableVisibilities, newPlacement, viewerOf } from '../notes/abilities.ts';
import { createNote } from '../notes/api.ts';
import { uuid } from '../offline/store.ts';
import { createShopping } from '../shopping/api.ts';
import { listedNames, shoppingName } from '../shopping/duplicates.ts';
import { mutateTask } from '../tasks/api.ts';
import { createBody } from '../tasks/NewTaskScreen.tsx';
import { RecordPicker, useTaskMembers } from '../tasks/options.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { CompactDraft } from './CompactDraft.tsx';
import { needsReview, selectedCount } from './compact.ts';

type Row = {
  id: string;
  draft: AutoDraft;
  place: Visibility;
  duplicate?: boolean;
  selected: boolean;
  confirmed: boolean;
};
const kinds = { task: 'Дело', shopping: 'Покупка', note: 'Заметка' };
export function AiDrafts({
  drafts,
  house,
  place,
  onClose,
}: {
  drafts: AutoDraft[];
  house: string | null;
  place: Visibility;
  onClose: () => void;
}) {
  const { me } = useHousehold();
  const viewer = viewerOf(me);
  const options = (kind: AutoDraft['kind']) =>
    creatableVisibilities(viewer, house, kind === 'shopping' ? 'shopping_item' : kind);
  const [rows, setRows] = useState<Row[]>(() =>
    drafts.map((draft) => ({
      id: uuid(),
      selected: true,
      confirmed: false,
      draft,
      place: options(draft.kind).includes(place) ? place : 'personal',
    })),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const client = useQueryClient();
  const state = useAction();
  const members = useTaskMembers(house);
  const keys = useRef(new Map<string, { body: string; key: string }>());
  function operationKey(id: string, body: unknown) {
    const text = JSON.stringify(body);
    let known = keys.current.get(id);
    if (known?.body !== text) {
      known = { body: text, key: uuid() };
      keys.current.set(id, known);
    }
    return known.key;
  }
  function update(id: string, key: string, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              duplicate: false,
              draft: {
                ...row.draft,
                [key]: {
                  value: ['title', 'body'].includes(key) ? value : value || null,
                  confident: true,
                },
              } as AutoDraft,
            }
          : row,
      ),
    );
  }
  async function save(selected: Row[]) {
    await state.run(async () => {
      const lists = new Map<Visibility, Set<string>>();
      for (const row of selected) {
        if (!row.confirmed && needsReview(row.draft)) throw new ApiError(400, 'INVALID_INPUT');
        const draft = row.draft;
        const placement = newPlacement(row.place, house);
        if (!draft.title.value?.trim()) throw new ApiError(400, 'INVALID_INPUT');
        if (draft.kind === 'task') {
          if (draft.time.value && !draft.date.value) throw new ApiError(400, 'INVALID_QUICKLINE');
          const body = createBody(
            {
              ...TaskFields.parse({
                title: draft.title.value,
                planOn: draft.date.value,
                planTime: draft.time.value,
              }),
              assigneeId: draft.assigneeId.value ?? me.id,
              objectId: draft.objectId.value ?? '',
              householdId: house ?? '',
              visibility: row.place,
              repeatScope: 'this',
            },
            me.personalSpaceId,
          );
          await mutateTask('tasks', { ...body, idempotencyKey: operationKey(row.id, body) });
        } else if (draft.kind === 'shopping') {
          let names = lists.get(row.place);
          if (!names) {
            names = await listedNames(row.place, house);
            lists.set(row.place, names);
          }
          const name = shoppingName(draft.title.value);
          if (names.has(name)) {
            setRows((current) =>
              current.map((item) => (item.id === row.id ? { ...item, duplicate: true } : item)),
            );
            continue;
          }
          const body = {
            title: draft.title.value.trim(),
            quantity: draft.quantity.value?.trim() || null,
            ...(placement ? { placement } : {}),
          };
          await createShopping({ ...body, idempotencyKey: operationKey(row.id, body) });
          names.add(name);
        } else {
          const body = {
            title: draft.title.value.trim(),
            body: draft.body.value ?? '',
            pinned: false,
            checklist: [],
          };
          await createNote(
            {
              ...body,
              idempotencyKey: operationKey(row.id, { ...body, placement }),
            },
            placement,
          );
        }
        // Подтверждённое убирается сразу: сбой следующей карточки не повторяет сохранение предыдущей.
        setRows((current) => current.filter((item) => item.id !== row.id));
        await Promise.all(
          ['tasks', 'shopping', 'notes'].map((key) =>
            client.invalidateQueries({ queryKey: [key] }),
          ),
        );
      }
    });
  }
  function field(row: Row, key: string, label: string, type = 'text', maxLength = 200) {
    const value = row.draft[key as keyof AutoDraft];
    if (typeof value !== 'object' || !value) return null;
    return (
      <label className="field">
        <span>
          {label}
          {!value.confident ? ' — проверьте' : ''}
        </span>
        <input
          className="input"
          type={type}
          value={value.value ?? ''}
          maxLength={maxLength}
          onChange={(e) => update(row.id, key, e.target.value)}
        />
      </label>
    );
  }
  return (
    <Sheet
      open
      title="Черновики ИИ"
      description="Проверьте поля и кто увидит запись. Без сохранения записи не появятся."
      onOpenChange={(open) => {
        if (!open && !state.pending) onClose();
      }}
    >
      <fieldset disabled={state.disabled} className="ai-drafts">
        {rows.length ? (
          rows.map((row, index) => (
            <section
              className="ai-draft"
              key={row.id}
              aria-label={`${kinds[row.draft.kind]} ${index + 1}`}
            >
              <CompactDraft
                assignee={
                  row.draft.kind === 'task'
                    ? (members.data?.find(
                        (m) =>
                          m.accountId ===
                          (row.draft.kind === 'task' ? row.draft.assigneeId.value : null),
                      )?.displayName ?? me.displayName)
                    : undefined
                }
                kind={row.draft.kind}
                title={row.draft.title.value}
                fields={row.draft}
                place={
                  row.place === 'personal'
                    ? 'Только я'
                    : row.place === 'adults'
                      ? 'Взрослые'
                      : 'Семья'
                }
                review={!row.confirmed && needsReview(row.draft)}
                selected={row.selected}
                onSelect={(selected) =>
                  setRows((current) =>
                    current.map((r) => (r.id === row.id ? { ...r, selected } : r)),
                  )
                }
                onEdit={() => setEditing(row.id)}
              />
              {row.duplicate ? <p role="status">Уже в списке</p> : null}
              {editing === row.id ? (
                <Sheet
                  open
                  title="Изменить черновик"
                  description="Проверьте все поля и подтвердите."
                  onOpenChange={() => setEditing(null)}
                >
                  <h3>
                    {kinds[row.draft.kind]} {index + 1}
                  </h3>
                  {field(row, 'title', 'Название')}
                  {row.draft.kind === 'task' ? (
                    <>
                      {field(row, 'date', 'Дата', 'date')}
                      {field(row, 'time', 'Время', 'time')}
                      {row.draft.time.value && !row.draft.date.value ? (
                        <p>Для времени нужна дата.</p>
                      ) : null}
                      <label className="field">
                        <span>
                          Исполнитель{!row.draft.assigneeId.confident ? ' — проверьте' : ''}
                        </span>
                        <select
                          className="input"
                          value={row.draft.assigneeId.value ?? ''}
                          onChange={(e) => update(row.id, 'assigneeId', e.target.value)}
                        >
                          <option value="">Я ({me.displayName})</option>
                          {(members.data ?? [])
                            .filter((m) => !m.formerMember)
                            .map((m) => (
                              <option value={m.accountId} key={m.accountId}>
                                {m.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <RecordPicker
                        kind="object"
                        label={`Объект${!row.draft.objectId.confident ? ' — проверьте' : ''}`}
                        value={row.draft.objectId.value ?? ''}
                        onChange={(value) => update(row.id, 'objectId', value)}
                      />
                    </>
                  ) : null}
                  {row.draft.kind === 'shopping'
                    ? field(row, 'quantity', 'Количество', 'text', 100)
                    : null}
                  {row.draft.kind === 'note' ? (
                    <label className="field">
                      <span>Текст{!row.draft.body.confident ? ' — проверьте' : ''}</span>
                      <textarea
                        className="textarea"
                        rows={4}
                        value={row.draft.body.value ?? ''}
                        maxLength={20000}
                        onChange={(e) => update(row.id, 'body', e.target.value)}
                      />
                    </label>
                  ) : null}
                  <VisibilityPicker
                    value={row.place}
                    options={options(row.draft.kind)}
                    onChange={(place) =>
                      setRows((current) =>
                        current.map((r) =>
                          r.id === row.id ? { ...r, place, duplicate: false } : r,
                        ),
                      )
                    }
                  />
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => {
                        setRows((current) =>
                          current.map((r) => (r.id === row.id ? { ...r, confirmed: true } : r)),
                        );
                        setEditing(null);
                      }}
                    >
                      Готово
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setRows((current) => current.filter((r) => r.id !== row.id))}
                    >
                      Убрать
                    </button>
                  </div>
                </Sheet>
              ) : null}
            </section>
          ))
        ) : (
          <p role="status">Черновиков не осталось</p>
        )}
        <button
          type="button"
          className="btn btn--primary"
          disabled={
            !selectedCount(rows) ||
            rows.some((r) => r.selected && !r.confirmed && needsReview(r.draft))
          }
          onClick={() => void save(rows.filter((r) => r.selected))}
        >
          {state.pending ? 'Сохраняем…' : `Сохранить все (${selectedCount(rows)})`}
        </button>
      </fieldset>
      <ErrorNotice error={state.error} />
      <button
        type="button"
        className="btn btn--secondary"
        disabled={state.pending}
        onClick={onClose}
      >
        Закрыть черновики
      </button>
    </Sheet>
  );
}
