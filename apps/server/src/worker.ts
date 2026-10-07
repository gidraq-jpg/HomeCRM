import { createPool } from '@homecrm/db';
import { TimeZone } from '@homecrm/shared';
import { z } from 'zod';
import { startDeadlineJobs } from './deadlines/jobs.ts';
import { reportWorkerError } from './deadlines/logging.ts';

const Environment = z.object({
  DATABASE_URL_WORKER: z
    .string()
    .url()
    .refine((x) => /^postgres(ql)?:/.test(x)),
  HOME_TIME_ZONE: TimeZone.default('Asia/Yekaterinburg'),
});
const parsed = Environment.safeParse(process.env);
if (!parsed.success) {
  reportWorkerError(parsed.error, 'Invalid worker configuration');
  process.exit(1);
}
const report = reportWorkerError;
const pool = createPool(parsed.data.DATABASE_URL_WORKER, { max: 4, onError: report });
try {
  const stop = await startDeadlineJobs(pool, parsed.data.HOME_TIME_ZONE, report);
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void stop()
        .then(() => pool.end())
        .then(
          () => process.exit(0),
          (error: unknown) => {
            report(error);
            process.exit(1);
          },
        );
    });
} catch (error) {
  report(error);
  await pool.end().catch(report);
  process.exit(1);
}
