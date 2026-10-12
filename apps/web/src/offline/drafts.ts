import { useEffect, useRef, useState } from 'react';
import { assertIdentity, changed, LocalFailure, localMessage, requestTicket } from './identity.ts';
import { offlineDB } from './store.ts';
/** Черновик формы отделён от намерения; сохранение черновика не означает отправку. */
export function useDurableDraft<T>(draftKey: string, value: T, restore: (value: T) => void) {
  const apply = useRef(restore);
  apply.current = restore;
  const ready = useRef(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    ready.current = false;
    void (async () => {
      try {
        const owner = await requestTicket();
        const row = await offlineDB.drafts.get(`${owner.owner}:${draftKey}`);
        await assertIdentity(owner);
        if (active && row) apply.current(row.data as T);
        if (active) ready.current = true;
      } catch (error) {
        if (active && error instanceof LocalFailure && error.code !== 'ACCOUNT_CHANGED')
          setProblem(localMessage(error));
      }
    })();
    return () => {
      active = false;
    };
  }, [draftKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!ready.current) return;
      void (async () => {
        try {
          const owner = await requestTicket();
          await offlineDB.transaction('rw', offlineDB.identity, offlineDB.drafts, async () => {
            await assertIdentity(owner);
            const exists = await offlineDB.drafts.get(`${owner.owner}:${draftKey}`);
            if (
              !exists &&
              (await offlineDB.drafts
                .where('owner')
                .equals(owner.owner ?? '')
                .filter((row) => row.key.includes(':form:'))
                .count()) >= 100
            )
              throw new LocalFailure('LOCAL_QUOTA');
            await offlineDB.drafts.put({
              key: `${owner.owner}:${draftKey}`,
              owner: owner.owner ?? '',
              data: value,
              updatedAt: Date.now(),
            });
          });
          setProblem(null);
        } catch (error) {
          setProblem(
            error instanceof Error && /Quota/.test(error.name)
              ? 'Черновик не сохранён: на устройстве недостаточно места. Оставьте форму открытой.'
              : 'Не удалось сохранить черновик на устройстве. Оставьте форму открытой.',
          );
          changed('storage-error');
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draftKey, value]);
  return problem;
}
export async function clearDraft(key: string) {
  const owner = await requestTicket();
  await offlineDB.drafts.delete(`${owner.owner}:${key}`);
}
