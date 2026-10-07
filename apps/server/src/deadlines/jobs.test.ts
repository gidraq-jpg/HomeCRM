import type { Pool } from '@homecrm/db';
import { beforeEach, expect, it, vi } from 'vitest';
import { refreshDeadlines } from './engine.ts';
import { startDeadlineJobs } from './jobs.ts';

const mocks = vi.hoisted(() => ({
  boss: {
    on: vi.fn(),
    start: vi.fn(),
    createQueue: vi.fn(),
    work: vi.fn(),
    schedule: vi.fn(),
    send: vi.fn(),
    stop: vi.fn(),
  },
  listener: { on: vi.fn(), query: vi.fn(), release: vi.fn() },
}));
vi.mock('@homecrm/db', () => ({ createWorkerDatabase: vi.fn(() => ({})) }));
vi.mock('pg-boss', () => ({
  PgBoss: class {
    constructor() {
      Object.assign(this, mocks.boss);
    }
  },
}));
vi.mock('./engine.ts', () => ({
  enqueueDeadlineWarnings: vi.fn(),
  initializeHouseTimeZones: vi.fn(),
  refreshDeadlines: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const pool = { connect: async () => mocks.listener } as unknown as Pool;

it('передаёт исходную ошибку в журнал, а pg-boss получает только безопасное сообщение', async () => {
  const report = vi.fn();
  const failure = Object.assign(new TypeError('Скрытое вымышленное название'), { code: '23505' });
  vi.mocked(refreshDeadlines).mockRejectedValueOnce(failure);
  const stop = await startDeadlineJobs(pool, 'Europe/Moscow', report);
  const handle = mocks.boss.work.mock.calls[0]?.[1];
  await expect(handle([{ data: { full: true } }])).rejects.toThrow('Deadline job failed');
  expect(report).toHaveBeenCalledExactlyOnceWith(failure);
  await stop();
});

it('передаёт ошибки очереди, слушателя и отправки с исходным кодом', async () => {
  const report = vi.fn();
  const failure = Object.assign(new Error('Скрытое вымышленное название'), { code: 'ECONNRESET' });
  const stop = await startDeadlineJobs(pool, 'Europe/Moscow', report);
  const bossError = mocks.boss.on.mock.calls.find(([event]) => event === 'error')?.[1];
  const listenerError = mocks.listener.on.mock.calls.find(([event]) => event === 'error')?.[1];
  const notification = mocks.listener.on.mock.calls.find(
    ([event]) => event === 'notification',
  )?.[1];
  bossError(failure);
  listenerError(failure);
  mocks.boss.send.mockRejectedValueOnce(failure);
  notification();
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(3));
  expect(report.mock.calls).toEqual([[failure], [failure], [failure]]);
  await stop();
});
