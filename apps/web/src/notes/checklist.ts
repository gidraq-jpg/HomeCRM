import { type ChecklistInput, type ChecklistItem, MAX_ITEMS, MAX_TITLE } from './api.ts';

// Чек-лист в форме: порядок, отметка, добавление и удаление. Чистые функции без React,
// чтобы правила можно было проверить без браузера.

export interface DraftItem {
  /** Ключ строки в форме: у нового пункта ещё нет `id` от сервера. */
  key: string;
  id?: string;
  title: string;
  done: boolean;
}

let counter = 0;
export function nextKey(): string {
  counter += 1;
  return `item-${counter}`;
}

/** Действующие пункты карточки в порядке `position`; удалённые не показываются. */
export function fromCard(items: readonly ChecklistItem[]): DraftItem[] {
  return items
    .filter((item) => item.deletedAt === null)
    .toSorted((a, b) => a.position - b.position)
    .map((item) => ({ key: item.id, id: item.id, title: item.title, done: item.done }));
}

/** Пункты для сохранения: пустые строки пропускаются, названия обрезаются по краям. */
export function toInput(items: readonly DraftItem[]): ChecklistInput[] {
  return items
    .map((item) => ({ ...item, title: item.title.trim() }))
    .filter((item) => item.title !== '')
    .map(({ id, title, done }) => ({ ...(id ? { id } : {}), title, done }));
}

export function addItem(items: readonly DraftItem[], title = ''): DraftItem[] {
  if (items.length >= MAX_ITEMS) return [...items];
  return [...items, { key: nextKey(), title, done: false }];
}

export function updateItem(
  items: readonly DraftItem[],
  key: string,
  change: Partial<Pick<DraftItem, 'title' | 'done'>>,
): DraftItem[] {
  return items.map((item) =>
    item.key === key
      ? { ...item, ...change, ...(change.title === undefined ? {} : { title: clip(change.title) }) }
      : item,
  );
}

function clip(title: string): string {
  return title.length > MAX_TITLE ? title.slice(0, MAX_TITLE) : title;
}

export function removeItem(items: readonly DraftItem[], key: string): DraftItem[] {
  return items.filter((item) => item.key !== key);
}

/** Сдвигает пункт на `delta` мест; за края списка не выходит. */
export function moveItem(items: readonly DraftItem[], key: string, delta: -1 | 1): DraftItem[] {
  const from = items.findIndex((item) => item.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved) next.splice(to, 0, moved);
  return next;
}

/** «2 из 5»: сколько пунктов отмечено. */
export function progress(items: readonly Pick<DraftItem, 'done'>[]): {
  done: number;
  total: number;
} {
  return { done: items.filter((item) => item.done).length, total: items.length };
}

export function sameChecklist(a: readonly ChecklistInput[], b: readonly ChecklistInput[]): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        item.id === other.id &&
        item.title === other.title &&
        item.done === other.done
      );
    })
  );
}
