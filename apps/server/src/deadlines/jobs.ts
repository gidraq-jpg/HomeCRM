import { createWorkerDatabase, type Pool } from '@homecrm/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { dispatchNotifications } from '../notifications/dispatcher.ts';
import type { PushSender } from '../notifications/transport.ts';
import { enqueueDeadlineWarnings, initializeHouseTimeZones, refreshDeadlines } from './engine.ts';

export const DEADLINE_QUEUE = 'deadline-engine';
export async function startDeadlineJobs(
  pool: Pool,
  timeZone: string,
  report: (error: unknown) => void,
  send?: PushSender,
) {
  const db = createWorkerDatabase(pool);
  const boss = new PgBoss({
    schema: 'pgboss',
    createSchema: false,
    db: { executeSql: async (text, values) => pool.query(text, values) },
  });
  boss.on('error', report);
  await boss.start();
  if (send) {
    await boss.createQueue('push-dispatch', { retryLimit: 5, retryDelay: 30, retryBackoff: true });
    await boss.work('push-dispatch', async (jobs) => {
      try {
        for (const job of jobs) {
          z.strictObject({}).parse(job.data);
          await dispatchNotifications(pool, send);
        }
      } catch (error) {
        report(error);
        throw new Error('Push dispatch failed');
      }
    });
    await boss.schedule('push-dispatch', '* * * * *', {}, { tz: 'UTC' });
    await boss.send('push-dispatch', {});
  }
  await boss.createQueue(DEADLINE_QUEUE, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
  const Job = z.strictObject({ full: z.boolean().default(false) });
  await boss.work(DEADLINE_QUEUE, async (jobs) => {
    try {
      for (const job of jobs) {
        const { full } = Job.parse(job.data);
        await initializeHouseTimeZones(db, timeZone);
        await refreshDeadlines(db, new Date(), full);
        await enqueueDeadlineWarnings(db);
        if (send)
          await boss.send('push-dispatch', {}, { singletonKey: 'dispatch', singletonSeconds: 1 });
      }
    } catch (error) {
      report(error);
      throw new Error('Deadline job failed');
    }
  });
  await boss.schedule(DEADLINE_QUEUE, '0 0 * * *', { full: true }, { tz: 'UTC', key: 'daily' });
  // Страховка пропущенного NOTIFY; сама очередь и флаг правила переживают перезапуск.
  await boss.schedule(
    DEADLINE_QUEUE,
    '*/5 * * * *',
    { full: true },
    { tz: 'UTC', key: 'warnings' },
  );
  const dispatch = () =>
    boss.send(DEADLINE_QUEUE, { full: true }, { singletonKey: 'refresh', singletonSeconds: 1 });
  const listener = await pool.connect();
  listener.on('notification', () => {
    void dispatch().catch(report);
  });
  listener.on('error', report);
  await listener.query('LISTEN homecrm_deadlines');
  await dispatch();
  return async () => {
    await listener.query('UNLISTEN homecrm_deadlines');
    listener.release();
    await boss.stop();
  };
}
