import { z } from 'zod';
import { ApiError, apiRequest } from '../auth/api.ts';

// Один запрос за раз: синхронизация и открытый экран могут предложить один элемент одновременно.
const running = new Map<string, Promise<unknown>>();
let tail: Promise<unknown> = Promise.resolve();
let limited = false;
export function parseCapturedInbox(id: string, consent?: string) {
  const known = running.get(id);
  if (known) return known;
  const request = tail.then(async () => {
    if (limited && !consent) return;
    try {
      return await apiRequest(
        'POST',
        `inbox/${id}/parse`,
        z.object({ ok: z.literal(true) }),
        consent ? { consent } : {},
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['AI_BUSY', 'AI_QUOTA', 'AI_DAILY_LIMIT'].includes(error.code)
      )
        limited = true;
      throw error;
    }
  });
  running.set(id, request);
  tail = request.catch(() => undefined);
  void tail.then(() => running.delete(id));
  return request;
}
