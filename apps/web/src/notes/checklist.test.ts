import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from './api.ts';
import {
  addItem,
  type DraftItem,
  fromCard,
  moveItem,
  progress,
  removeItem,
  sameChecklist,
  toInput,
  updateItem,
} from './checklist.ts';

const server = (
  id: string,
  title: string,
  position: number,
  done = false,
  deletedAt: string | null = null,
): ChecklistItem => ({
  id,
  title,
  done,
  position,
  deletedAt,
});

describe('чек-лист в форме', () => {
  it('берёт действующие пункты в порядке position, удалённые пропускает', () => {
    const items = fromCard([
      server('b', 'Второй', 1),
      server('x', 'Удалённый', 2, false, '2026-10-06T08:00:00.000Z'),
      server('a', 'Первый', 0, true),
    ]);
    expect(items.map((item) => [item.id, item.title, item.done])).toEqual([
      ['a', 'Первый', true],
      ['b', 'Второй', false],
    ]);
  });

  it('при сохранении у старого пункта есть id, у нового нет; пустые пропускаются', () => {
    const items: DraftItem[] = [
      { key: 'k1', id: 'a', title: '  Хлеб ', done: true },
      { key: 'k2', title: 'Молоко', done: false },
      { key: 'k3', title: '   ', done: false },
    ];
    expect(toInput(items)).toEqual([
      { id: 'a', title: 'Хлеб', done: true },
      { title: 'Молоко', done: false },
    ]);
  });

  it('добавляет пункт в конец, не больше 200', () => {
    let items: DraftItem[] = [];
    for (let i = 0; i < 205; i += 1) items = addItem(items, `Пункт ${i}`);
    expect(items).toHaveLength(200);
    expect(new Set(items.map((item) => item.key)).size).toBe(200);
  });

  it('двигает пункт и не выходит за края', () => {
    const items = ['a', 'b', 'c'].map((key) => ({ key, title: key, done: false }));
    expect(moveItem(items, 'b', -1).map((item) => item.key)).toEqual(['b', 'a', 'c']);
    expect(moveItem(items, 'b', 1).map((item) => item.key)).toEqual(['a', 'c', 'b']);
    expect(moveItem(items, 'a', -1).map((item) => item.key)).toEqual(['a', 'b', 'c']);
    expect(moveItem(items, 'c', 1).map((item) => item.key)).toEqual(['a', 'b', 'c']);
  });

  it('отмечает, правит и удаляет пункт; название обрезается до 200 знаков', () => {
    const items = [{ key: 'a', title: 'Хлеб', done: false }];
    expect(updateItem(items, 'a', { done: true })[0]?.done).toBe(true);
    expect(updateItem(items, 'a', { title: 'я'.repeat(300) })[0]?.title).toHaveLength(200);
    expect(removeItem(items, 'a')).toEqual([]);
  });

  it('считает выполненные и сравнивает списки', () => {
    expect(progress([{ done: true }, { done: false }, { done: true }])).toEqual({
      done: 2,
      total: 3,
    });
    const a = [{ id: 'a', title: 'Хлеб', done: false }];
    expect(sameChecklist(a, [{ id: 'a', title: 'Хлеб', done: false }])).toBe(true);
    expect(sameChecklist(a, [{ id: 'a', title: 'Хлеб', done: true }])).toBe(false);
    expect(sameChecklist(a, [])).toBe(false);
  });
});
