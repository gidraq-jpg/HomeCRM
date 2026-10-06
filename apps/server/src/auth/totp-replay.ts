// Код TOTP принимается один раз (RFC 6238, п. 5.2; бэклог «К R0.2»). Библиотека в одном окне в
// 30 секунд принимает один и тот же код сколько угодно раз. Код занимается до проверки, под
// блокировкой на сам код: два одинаковых запроса подряд или параллельно — второй получает отказ.
// Отметка лежит в таблице одноразовых значений библиотеки и уходит вместе с просроченными.
import { createHmac } from 'node:crypto';
import { type Database, sql, verifications } from '@homecrm/db';
import { pgError } from './provision.ts';

/** Окно TOTP — до трёх шагов по 30 секунд (соседние шаги библиотека допускает): две минуты с запасом. */
const CLAIM_TTL_SECONDS = 120;
const PERIOD_SECONDS = 30;

/** Занимает код участника; в базе и параметрах SQL остаётся только HMAC, а не действующий код. */
export async function claimTotpCode(
  db: Database,
  accountId: string,
  code: string,
  secret: string,
): Promise<boolean> {
  const digest = (parts: readonly unknown[]): string =>
    createHmac('sha256', secret).update(JSON.stringify(parts)).digest('base64url');
  // Блокировка общая для кода даже на границе шагов; в SQL не передаётся открытый код.
  const lockKey = digest(['totp-lock', accountId, code]);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const clock = await tx.execute<{ step: string }>(
        sql`SELECT floor(extract(epoch FROM now()) / ${PERIOD_SECONDS})::bigint AS step`,
      );
      const step = Number(clock.rows[0]?.step);
      if (!Number.isSafeInteger(step)) throw new Error('Invalid TOTP replay clock');
      const identifierFor = (at: number): string =>
        `totp-used:${digest(['totp-used', accountId, at, code])}`;
      // Проверяем предыдущие шаги всего срока отметки: переход через 30 секунд не открывает повтор.
      const identifiers = Array.from(
        { length: Math.ceil(CLAIM_TTL_SECONDS / PERIOD_SECONDS) + 1 },
        (_, offset) => identifierFor(step - offset),
      );
      const markers = sql.join(
        identifiers.map((identifier) => sql`${identifier}`),
        sql`, `,
      );
      const used = await tx.execute(
        sql`SELECT 1 FROM verifications WHERE identifier IN (${markers}) AND expires_at > now()`,
      );
      if (used.rows.length > 0) return false;
      await tx.insert(verifications).values({
        identifier: identifierFor(step),
        value: '1',
        expiresAt: sql`now() + make_interval(secs => ${CLAIM_TTL_SECONDS})`,
      });
      return true;
    });
  } catch (error) {
    // Drizzle включает запрос и параметры в message/cause. Пробрасываем безопасный контекст
    // без исходной ошибки: библиотека пишет его в журнал, а проверка входа остаётся закрытой.
    const { code: sqlState } = pgError(error);
    const detail = sqlState !== undefined && /^[0-9A-Z]{5}$/.test(sqlState) ? ` (${sqlState})` : '';
    throw new Error(`TOTP replay protection database operation failed${detail}`);
  }
}
