// Журнал заглушки: одна строка JSON на событие в DATA_DIR/probe-log.jsonl.
// Подписки и отправленные push восстанавливаются из журнала при запуске.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PushSubscriptionJson } from './probe.ts';

const MAX_LOG_BYTES = 20 * 1024 * 1024;

export interface SubscriptionRecord {
  id: string;
  at: string;
  label: string;
  subscription: PushSubscriptionJson;
}

export type ProbeEvent =
  | { type: 'result'; at: string; data: Record<string, unknown> }
  | ({ type: 'subscription' } & SubscriptionRecord)
  | {
      type: 'push-sent';
      at: string;
      pushId: string;
      subscriptionId: string;
      label: string;
      delaySec: number;
      status: number | null;
      error?: string;
    }
  | {
      type: 'push-ack';
      at: string;
      pushId: string;
      phoneLatencyMs: number | null;
      serverLatencyMs: number | null;
    };

export interface ProbeStore {
  /** Записывает событие; false — журнал переполнен. */
  append(event: ProbeEvent): boolean;
  events(): readonly ProbeEvent[];
  subscriptions: ReadonlyMap<string, SubscriptionRecord>;
  /** Момент отправки push по его id, мс. */
  sentAt(pushId: string): number | undefined;
}

function parseLine(line: string): ProbeEvent[] {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && 'type' in value
      ? [value as ProbeEvent]
      : [];
  } catch {
    return []; // повреждённая строка, например после сбоя питания, пропускается
  }
}

export function openStore(dataDir: string): ProbeStore {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'probe-log.jsonl');
  const events: ProbeEvent[] = existsSync(file)
    ? readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(parseLine)
    : [];
  const subscriptions = new Map<string, SubscriptionRecord>();
  const sentAt = new Map<string, number>();

  const index = (event: ProbeEvent): void => {
    if (event.type === 'subscription') {
      const { type: _type, ...record } = event;
      subscriptions.set(record.id, record);
    }
    if (event.type === 'push-sent') sentAt.set(event.pushId, Date.parse(event.at));
  };
  for (const event of events) index(event);

  return {
    subscriptions,
    events: () => events,
    sentAt: (pushId) => sentAt.get(pushId),
    append(event) {
      const size = existsSync(file) ? statSync(file).size : 0;
      if (size > MAX_LOG_BYTES) return false;
      appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
      events.push(event);
      index(event);
      return true;
    },
  };
}
