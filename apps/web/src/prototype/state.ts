import type { KeyValueStorage } from '../access/scope.ts';
import { isVisibility, type Visibility } from '../access/visibility.ts';
import { SEED_MAIN_TASK_ID, SEED_RECORDS } from './data/index.ts';
import type { ProtoRecord, RecordKind } from './model.ts';

// Состояние прототипа: что пользователь добавил и изменил поверх вымышленных данных.
// Хранится на устройстве, чтобы случайное обновление страницы не стёрло заметку во время
// проверки. «Начать прототип заново» в разделе «Ещё» возвращает исходное состояние.

export interface ReadingsEntry {
  /** Введённые значения по счётчикам, как их набрали: с запятой или точкой. */
  values: Record<string, string>;
  transmitted: boolean;
}

export interface PrototypeState {
  version: 1;
  /** Записи, созданные в прототипе через «+». */
  added: ProtoRecord[];
  /** Изменённый доступ: «Поделиться…», «Кто видит», «Сделать личной…». */
  visibility: Record<string, Visibility>;
  /** Отметки «сделано» поверх исходных статусов дел. */
  done: Record<string, boolean>;
  /** Отметки «куплено» поверх исходного списка. */
  bought: Record<string, boolean>;
  mainTaskId: string | null;
  /** Введённые показания по объектам. */
  readings: Record<string, ReadingsEntry>;
}

export type PrototypeAction =
  | { type: 'add'; record: ProtoRecord }
  | { type: 'setVisibility'; id: string; visibility: Visibility }
  | { type: 'setDone'; id: string; done: boolean }
  | { type: 'setBought'; id: string; bought: boolean }
  | { type: 'setMain'; id: string | null }
  | { type: 'saveReadings'; propertyId: string; values: Record<string, string> }
  | { type: 'markTransmitted'; propertyId: string }
  | { type: 'reset' };

export function initialState(): PrototypeState {
  return {
    version: 1,
    added: [],
    visibility: {},
    done: {},
    bought: {},
    mainTaskId: SEED_MAIN_TASK_ID,
    readings: {},
  };
}

export function reducer(state: PrototypeState, action: PrototypeAction): PrototypeState {
  switch (action.type) {
    case 'add':
      return { ...state, added: [...state.added, action.record] };
    case 'setVisibility':
      return { ...state, visibility: { ...state.visibility, [action.id]: action.visibility } };
    case 'setDone': {
      const mainTaskId = action.done && state.mainTaskId === action.id ? null : state.mainTaskId;
      return { ...state, mainTaskId, done: { ...state.done, [action.id]: action.done } };
    }
    case 'setBought':
      return { ...state, bought: { ...state.bought, [action.id]: action.bought } };
    case 'setMain':
      return { ...state, mainTaskId: action.id };
    case 'saveReadings':
      return {
        ...state,
        readings: {
          ...state.readings,
          [action.propertyId]: { values: action.values, transmitted: false },
        },
      };
    case 'markTransmitted': {
      const entry = state.readings[action.propertyId];
      if (entry === undefined) return state;
      return {
        ...state,
        readings: { ...state.readings, [action.propertyId]: { ...entry, transmitted: true } },
      };
    }
    case 'reset':
      return initialState();
  }
}

/** Вымышленные записи вместе с добавленными и со всеми изменениями поверх них. */
export function resolveRecords(state: PrototypeState): ProtoRecord[] {
  return [...SEED_RECORDS, ...state.added].map((record) => {
    const visibility = state.visibility[record.id] ?? record.visibility;
    if (record.kind === 'task') {
      const done = state.done[record.id];
      if (done === undefined) return { ...record, visibility };
      const status = done ? 'done' : record.status === 'done' ? 'open' : record.status;
      return { ...record, visibility, status };
    }
    if (record.kind === 'shopping') {
      return { ...record, visibility, bought: state.bought[record.id] ?? record.bought };
    }
    return { ...record, visibility };
  });
}

export const STATE_STORAGE_KEY = 'homecrm.prototype.state';

const KINDS: readonly RecordKind[] = [
  'task',
  'note',
  'shopping',
  'document',
  'contact',
  'property',
];

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringMap<T>(
  value: unknown,
  check: (item: unknown) => item is T,
): value is Record<string, T> {
  return isRecordObject(value) && Object.values(value).every(check);
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

function isAddedRecord(value: unknown): value is ProtoRecord {
  if (!isRecordObject(value)) return false;
  if (typeof value.id !== 'string' || !isVisibility(value.visibility)) return false;
  if (!KINDS.includes(value.kind as RecordKind)) return false;
  const label = value.kind === 'contact' ? value.name : value.title;
  return typeof label === 'string';
}

function isReadingsEntry(value: unknown): value is ReadingsEntry {
  return (
    isRecordObject(value) &&
    typeof value.transmitted === 'boolean' &&
    isStringMap(value.values, (item): item is string => typeof item === 'string')
  );
}

/** Разбирает сохранённое состояние; всё неожиданное — повод начать с исходного. */
export function parseState(raw: string | null): PrototypeState {
  if (raw === null) return initialState();
  try {
    const data: unknown = JSON.parse(raw);
    if (!isRecordObject(data) || data.version !== 1) return initialState();
    const { added, visibility, done, bought, mainTaskId, readings } = data;
    if (
      !Array.isArray(added) ||
      !added.every(isAddedRecord) ||
      !isStringMap(visibility, isVisibility) ||
      !isStringMap(done, isBoolean) ||
      !isStringMap(bought, isBoolean) ||
      !(mainTaskId === null || typeof mainTaskId === 'string') ||
      !isStringMap(readings, isReadingsEntry)
    ) {
      return initialState();
    }
    return { version: 1, added, visibility, done, bought, mainTaskId, readings };
  } catch (error) {
    console.warn('Saved prototype state is damaged, starting over', error);
    return initialState();
  }
}

export function loadState(storage: KeyValueStorage | null): PrototypeState {
  if (storage === null) return initialState();
  try {
    return parseState(storage.getItem(STATE_STORAGE_KEY));
  } catch (error) {
    console.warn('Cannot read the saved prototype state', error);
    return initialState();
  }
}

export function saveState(storage: KeyValueStorage | null, state: PrototypeState): void {
  if (storage === null) return;
  try {
    storage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Cannot save the prototype state, changes will be lost after reload', error);
  }
}

export function clearState(storage: KeyValueStorage | null): void {
  if (storage === null) return;
  try {
    storage.removeItem(STATE_STORAGE_KEY);
  } catch (error) {
    console.warn('Cannot clear the saved prototype state', error);
  }
}
