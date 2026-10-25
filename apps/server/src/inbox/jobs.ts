import type { Pool } from '@homecrm/db';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';

export async function cleanupInbox(pool: Pool) {
  await pool.query(
    "UPDATE inbox_items SET deleted_at=now() WHERE deleted_at IS NULL AND resolved_at IS NULL AND coalesce(restored_at,created_at)<=now()-interval '30 days'",
  );
  await pool.query("DELETE FROM inbox_items WHERE deleted_at < now()-interval '30 days'");
}
export async function startInboxJobs(pool: Pool, report: (error: unknown) => void) {
  const boss = new PgBoss({
    schema: 'pgboss',
    createSchema: false,
    db: { executeSql: (text, values) => pool.query(text, values) },
  });
  boss.on('error', report);
  await boss.start();
  await boss.createQueue('inbox-cleanup', { retryLimit: 0 });
  await boss.work('inbox-cleanup', async (jobs) => {
    try {
      for (const job of jobs) {
        z.strictObject({}).parse(job.data);
        await cleanupInbox(pool);
      }
    } catch (error) {
      report(error);
      throw new Error('Inbox cleanup failed');
    }
  });
  await boss.schedule('inbox-cleanup', '0 * * * *', {}, { tz: 'UTC' });
  await boss.send('inbox-cleanup', {}, { singletonKey: 'inbox-cleanup', singletonSeconds: 60 });
  return () => boss.stop();
}
