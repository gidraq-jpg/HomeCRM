import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Intent } from './store.ts';

// База и личность подменены: проверяется только, кто будет отправлять очередь.
vi.mock('./store.ts', () => {
  const query = {
    equals: () => query,
    filter: () => query,
    count: async () => 0,
    toArray: async () => [],
  };
  return {
    LIMITS: { intents: 300, blobBytes: Number.MAX_SAFE_INTEGER },
    offlineDB: {
      transaction: (...args: unknown[]) => (args.at(-1) as () => Promise<unknown>)(),
      outbox: { where: () => query, add: async () => undefined },
      blobs: { where: () => query, bulkAdd: async () => undefined },
      drafts: { put: async () => undefined },
    },
  };
});
vi.mock('./identity.ts', () => ({
  assertIdentity: async () => undefined,
  blockIdentity: async () => undefined,
  changed: () => undefined,
  LocalFailure: class extends Error {},
  LocalSaved: class extends Error {},
  offlineEvents: new EventTarget(),
  requestTicket: async () => undefined,
  setIdentity: async () => undefined,
  ticket: async () => ({ owner: null }),
}));
vi.mock('./snapshots.ts', () => ({ exactVersion: async () => undefined }));
vi.mock('../inbox/parse.ts', () => ({ parseCapturedInbox: async () => undefined }));

const { persistIntents } = await import('./queue.ts');

function useNavigator(onLine: boolean) {
  const register = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', {
    onLine,
    serviceWorker: { ready: Promise.resolve({ sync: { register } }) },
  });
  return register;
}

const intent = { id: 'fictional-intent', owner: 'fictional-owner', generation: 1 } as Intent;

afterEach(() => vi.unstubAllGlobals());

describe('кто отправляет очередь (D53c)', () => {
  it('в сети вкладка отправляет сама: фоновая отправка service worker не просится', async () => {
    const register = useNavigator(true);
    await persistIntents([intent]);
    await Promise.resolve();
    await Promise.resolve();
    expect(register).not.toHaveBeenCalled();
  });

  it('без сети запись ждёт фоновой отправки service worker', async () => {
    const register = useNavigator(false);
    await persistIntents([intent]);
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith('homecrm-outbox'));
  });
});
