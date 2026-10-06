import { createPool, createRoles } from '@homecrm/db';
import { startPostgres } from '../../../../../packages/db/src/testing/postgres.ts';

export default async function setup() {
  const postgres = await startPostgres('web-e2e');
  const pool = createPool(postgres.adminUrl, { max: 1 });
  try {
    const client = await pool.connect();
    try {
      await createRoles(client);
    } finally {
      client.release();
    }
  } catch (error) {
    await postgres.stop();
    throw error;
  } finally {
    await pool.end();
  }
  process.env.HOMECRM_TEST_PG_ADMIN_URL = postgres.adminUrl;
  return postgres.stop;
}
