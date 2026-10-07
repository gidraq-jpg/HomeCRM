// AUTH-8: тот же лимит по адресу и пути, что у Better Auth; счётчик живёт в базе.
import { type Database, eq, rateLimits, sql } from '@homecrm/db';

export const AUTH_RATE_LIMIT = { window: 60, max: 120 } as const;

/** Занять запрос атомарно. При отказе — сколько секунд осталось до конца окна. */
export async function reserveSessionRequest(db: Database, key: string): Promise<number | null> {
  const now = Date.now();
  const cutoff = now - AUTH_RATE_LIMIT.window * 1000;
  // ON CONFLICT блокирует строку: параллельные запросы не обгонят проверку лимита.
  const reserved = await db.execute(sql`
    INSERT INTO rate_limits (key, count, last_request) VALUES (${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.last_request <= ${cutoff} THEN 1 ELSE rate_limits.count + 1 END,
      last_request = ${now}
    WHERE rate_limits.last_request <= ${cutoff} OR rate_limits.count < ${AUTH_RATE_LIMIT.max}
    RETURNING last_request`);
  if (reserved.rows.length > 0) return null;
  const [counter] = await db
    .select({ lastRequest: rateLimits.lastRequest })
    .from(rateLimits)
    .where(eq(rateLimits.key, key));
  return Math.max(
    1,
    Math.ceil(((counter?.lastRequest ?? now) + AUTH_RATE_LIMIT.window * 1000 - now) / 1000),
  );
}
