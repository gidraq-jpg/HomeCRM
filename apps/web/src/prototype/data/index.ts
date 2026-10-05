import type { ProtoRecord } from '../model.ts';
import { CONTACTS } from './contacts.ts';
import { DOCUMENTS } from './documents.ts';
import { PROPERTIES } from './home.ts';
import { NOTES, SHOPPING, TASKS } from './tasks.ts';

export * from './contacts.ts';
export * from './documents.ts';
export * from './home.ts';
export * from './people.ts';
export * from './tasks.ts';

/** Все вымышленные записи, которые есть в прототипе до первого касания. */
export const SEED_RECORDS: readonly ProtoRecord[] = [
  ...PROPERTIES,
  ...DOCUMENTS,
  ...CONTACTS,
  ...TASKS,
  ...NOTES,
  ...SHOPPING,
];

/** Главное дело на сегодня, выбранное заранее. */
export const SEED_MAIN_TASK_ID = 'task-passport-docs';
