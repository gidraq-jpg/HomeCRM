import type { Intent } from '../offline/store.ts';
import { TaskCard } from './api.ts';

/** Серверный снимок при переподключении может прийти раньше подтверждения очереди. */
export function queuedStatus(
  card: TaskCard,
  intents: readonly Pick<
    Intent,
    'entity' | 'operation' | 'state' | 'createdAt' | 'body' | 'response'
  >[],
): TaskCard {
  let result = card;
  for (const intent of intents) {
    if (intent.entity !== card.id || intent.operation !== 'task_status') continue;
    if (intent.state === 'confirmed') {
      const parsed = TaskCard.strip().safeParse(intent.response);
      if (parsed.success && Date.parse(parsed.data.updatedAt) > Date.parse(result.updatedAt))
        result = parsed.data;
    } else if (['pending', 'sending', 'unknown'].includes(intent.state)) {
      const status = TaskCard.shape.status.safeParse(intent.body.status);
      if (status.success)
        result = {
          ...result,
          status: status.data,
          updatedAt: new Date(intent.createdAt).toISOString(),
        };
    }
  }
  return result;
}
