import { describe, expect, it, vi } from 'vitest';
import type { KeyValueStorage } from '../access/scope.ts';
import { filterByScope } from '../access/scope.ts';
import { SEED_MAIN_TASK_ID, SEED_RECORDS } from './data/index.ts';
import type { NoteRecord, TaskRecord } from './model.ts';
import {
  clearState,
  initialState,
  loadState,
  parseState,
  reducer,
  resolveRecords,
  STATE_STORAGE_KEY,
  saveState,
} from './state.ts';

const note = (id: string, visibility: NoteRecord['visibility']): NoteRecord => ({
  id,
  kind: 'note',
  visibility,
  title: `Заметка ${id}`,
  text: '',
  created: '2026-10-22',
});

const taskById = (state: ReturnType<typeof initialState>, id: string) =>
  resolveRecords(state).find(
    (record): record is TaskRecord => record.id === id && record.kind === 'task',
  );

describe('записи прототипа', () => {
  it('исходное состояние совпадает с вымышленными данными', () => {
    expect(resolveRecords(initialState())).toEqual(SEED_RECORDS);
  });

  it('добавленная запись попадает в список и подчиняется переключателю', () => {
    const state = reducer(initialState(), { type: 'add', record: note('мой-секрет', 'personal') });
    const notes = resolveRecords(state).filter((record) => record.kind === 'note');
    expect(notes.map((record) => record.id)).toContain('мой-секрет');
    expect(filterByScope(notes, 'personal').map((record) => record.id)).toContain('мой-секрет');
    expect(filterByScope(notes, 'shared').map((record) => record.id)).not.toContain('мой-секрет');
  });

  it('смена доступа меняет запись и в режимах, не трогая исходные данные', () => {
    const state = reducer(initialState(), {
      type: 'setVisibility',
      id: 'doc-intl-passport',
      visibility: 'adults',
    });
    const passport = resolveRecords(state).find((record) => record.id === 'doc-intl-passport');
    expect(passport?.visibility).toBe('adults');
    expect(SEED_RECORDS.find((record) => record.id === 'doc-intl-passport')?.visibility).toBe(
      'personal',
    );
  });

  it('отметка «сделано» и её отмена возвращают исходный статус', () => {
    let state = initialState();
    expect(taskById(state, 'task-parcel')?.status).toBe('open');
    state = reducer(state, { type: 'setDone', id: 'task-parcel', done: true });
    expect(taskById(state, 'task-parcel')?.status).toBe('done');
    state = reducer(state, { type: 'setDone', id: 'task-parcel', done: false });
    expect(taskById(state, 'task-parcel')?.status).toBe('open');
  });

  it('выполненное дело можно вернуть, а у «жду» после отмены остаётся «жду»', () => {
    let state = reducer(initialState(), { type: 'setDone', id: 'task-contract-sent', done: false });
    expect(taskById(state, 'task-contract-sent')?.status).toBe('open');
    state = reducer(state, { type: 'setDone', id: 'task-plumber-bill', done: true });
    state = reducer(state, { type: 'setDone', id: 'task-plumber-bill', done: false });
    expect(taskById(state, 'task-plumber-bill')?.status).toBe('waiting');
  });

  it('главное дело снимается, когда оно выполнено', () => {
    expect(initialState().mainTaskId).toBe(SEED_MAIN_TASK_ID);
    const state = reducer(initialState(), { type: 'setDone', id: SEED_MAIN_TASK_ID, done: true });
    expect(state.mainTaskId).toBeNull();
    expect(reducer(state, { type: 'setMain', id: 'task-parcel' }).mainTaskId).toBe('task-parcel');
  });

  it('показания: сохранить, затем отметить переданными', () => {
    let state = reducer(initialState(), {
      type: 'saveReadings',
      propertyId: 'sadovaya',
      values: { 'm-sad-hvs-kitchen': '150,3' },
    });
    expect(state.readings.sadovaya).toEqual({
      values: { 'm-sad-hvs-kitchen': '150,3' },
      transmitted: false,
    });
    state = reducer(state, { type: 'markTransmitted', propertyId: 'sadovaya' });
    expect(state.readings.sadovaya?.transmitted).toBe(true);
    expect(reducer(initialState(), { type: 'markTransmitted', propertyId: 'нет' })).toEqual(
      initialState(),
    );
  });

  it('«Начать заново» возвращает исходное состояние', () => {
    let state = reducer(initialState(), { type: 'add', record: note('x', 'personal') });
    state = reducer(state, { type: 'setBought', id: 'shop-milk', bought: true });
    expect(reducer(state, { type: 'reset' })).toEqual(initialState());
  });
});

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe('сохранение состояния на устройстве', () => {
  it('записанное состояние читается обратно без потерь', () => {
    const storage = memoryStorage();
    const state = reducer(initialState(), { type: 'add', record: note('моя', 'personal') });
    saveState(storage, state);
    expect(loadState(storage)).toEqual(state);
  });

  it('повреждённые данные заменяются исходным состоянием', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const raw of [
      '',
      'не json',
      '[]',
      '{"version":2}',
      '{"version":1,"added":"нет"}',
      JSON.stringify({ ...initialState(), added: [{ id: 'x', kind: 'note' }] }),
      JSON.stringify({ ...initialState(), visibility: { a: 'все' } }),
    ]) {
      expect(parseState(raw)).toEqual(initialState());
    }
    warn.mockRestore();
  });

  it('без хранилища работает, но ничего не помнит', () => {
    expect(loadState(null)).toEqual(initialState());
    expect(() => saveState(null, initialState())).not.toThrow();
    expect(() => clearState(null)).not.toThrow();
  });

  it('сброс очищает сохранённое', () => {
    const storage = memoryStorage({ [STATE_STORAGE_KEY]: JSON.stringify(initialState()) });
    clearState(storage);
    expect(storage.data.has(STATE_STORAGE_KEY)).toBe(false);
  });
});
