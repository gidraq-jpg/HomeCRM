// Общие для OAuth и MCP проверки разрешений чата. Без маршрутов.
import { createHash } from 'node:crypto';
import { and, eq, spaces } from '@homecrm/db';
import type { AuthModule } from '../auth/module.ts';
import { Failure } from '../records/support.ts';

export const hash = (s: string) => createHash('sha256').update(s).digest('base64url');
export const idle = (date: Date) => date.getTime() < Date.now() - 90 * 86400000;
export async function chatHouse(module: AuthModule, accountId: string, houseId: string) {
  return module.appDb.withAccount(accountId, async (tx) => {
    const [house] = await tx
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, houseId), eq(spaces.kind, 'household')));
    if (!house?.chatEnabled)
      throw new Failure(403, 'CHAT_DISABLED', 'ИИ через чат выключен администратором дома.');
    return house;
  });
}
