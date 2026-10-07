import { afterEach, expect, it, vi } from 'vitest';
import { reportWorkerError } from './logging.ts';

afterEach(() => vi.restoreAllMocks());

it('пишет класс и код ошибки без сообщения, стека, SQL и параметров', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  class DatabaseError extends Error {}
  const error = Object.assign(new DatabaseError('Скрытое вымышленное название'), {
    code: '23505',
    detail: 'Скрытое вымышленное название',
    query: 'SELECT private_record',
    parameters: ['Скрытое вымышленное название'],
    cause: new Error('Скрытое вымышленное название'),
  });
  reportWorkerError(error);
  expect(log).toHaveBeenCalledExactlyOnceWith('Deadline worker operation failed', {
    errorClass: 'DatabaseError',
    errorCode: '23505',
  });
});

it('пишет системный код и обрабатывает отсутствие кода', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  reportWorkerError(Object.assign(new Error('private'), { code: 'ECONNRESET' }));
  reportWorkerError(new TypeError('private'));
  expect(log.mock.calls).toEqual([
    ['Deadline worker operation failed', { errorClass: 'Error', errorCode: 'ECONNRESET' }],
    ['Deadline worker operation failed', { errorClass: 'TypeError', errorCode: null }],
  ]);
});

it('не печатает произвольное исключение или недопустимый код', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  reportWorkerError('Скрытое вымышленное название');
  reportWorkerError(Object.assign(new Error('private'), { code: 'private record\nSQL' }));
  expect(log.mock.calls).toEqual([
    ['Deadline worker operation failed', { errorClass: 'UnknownError', errorCode: null }],
    ['Deadline worker operation failed', { errorClass: 'Error', errorCode: null }],
  ]);
});

it('сохраняет код PostgreSQL внутри обёртки и ограничивает обход cause', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cause = Object.assign(new Error('private record'), { code: '42501' });
  reportWorkerError(new Error('private SQL and parameters', { cause }));
  const cycle = new Error('private');
  cycle.cause = cycle;
  reportWorkerError(cycle);
  expect(log.mock.calls).toEqual([
    ['Deadline worker operation failed', { errorClass: 'Error', errorCode: '42501' }],
    ['Deadline worker operation failed', { errorClass: 'Error', errorCode: null }],
  ]);
});
