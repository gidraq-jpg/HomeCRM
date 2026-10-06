// Код TOTP принимается один раз (RFC 6238, п. 5.2; бэклог «К R0.2»). Библиотека в одном окне в
// 30 секунд принимает один и тот же код сколько угодно раз. Код занимается до проверки, под
// блокировкой на сам код: два одинаковых запроса подряд или параллельно — второй получает отказ.
// Отметка лежит в таблице одноразовых значений библиотеки и уходит вместе с просроченными.
import { type Database, sql, verifications } from '@homecrm/db';

/** Окно TOTP — до трёх шагов по 30 секунд (соседние шаги библиотека допускает): две минуты с запасом. */
const CLAIM_TTL_SECONDS = 120;

/** Занимает код участника; false — такой код уже был принят недавно. Сам код секретом после использования не является. */
export async function claimTotpCode(
  db: Database,
  accountId: string,
  code: string,
): Promise<boolean> {
  const identifier = `totp-used:${accountId}:${code}`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identifier}, 0))`);
    const used = await tx.execute(
      sql`SELECT 1 FROM verifications WHERE identifier = ${identifier} AND expires_at > now()`,
    );
    if (used.rows.length > 0) return false;
    await tx.insert(verifications).values({
      identifier,
      value: '1',
      expiresAt: sql`now() + make_interval(secs => ${CLAIM_TTL_SECONDS})`,
    });
    return true;
  });
}
