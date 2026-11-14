import { z } from 'zod';
import { ApiError, apiRequest } from '../auth/api.ts';

// Один запрос за раз: синхронизация и открытый экран могут предложить один элемент одновременно.
const running = new Map<string, Promise<unknown>>();
let tail: Promise<unknown> = Promise.resolve();
let limited = false;
export function parseCapturedInbox(id: string, consent?: string, identityConfirmed?: true) {
  const key = identityConfirmed ? `${id}:identity` : id;
  const known = running.get(key);
  if (known) return known;
  const request = tail.then(async () => {
    if (limited && !consent && !identityConfirmed) return;
    try {
      return await apiRequest('POST', `inbox/${id}/parse`, z.object({ ok: z.literal(true) }), {
        consent,
        identityConfirmed,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        ['AI_BUSY', 'AI_QUOTA', 'AI_DAILY_LIMIT'].includes(error.code)
      )
        limited = true;
      throw error;
    }
  });
  running.set(key, request);
  tail = request.catch(() => undefined);
  void tail.then(() => running.delete(key));
  return request;
}
