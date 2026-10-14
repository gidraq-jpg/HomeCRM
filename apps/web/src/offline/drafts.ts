import { useEffect, useRef, useState } from 'react';
import { type DraftBase, DraftEnvelope } from './draft-data.ts';
import { assertIdentity, changed, LocalFailure, localMessage, requestTicket } from './identity.ts';
import { offlineDB } from './store.ts';

/** Версия принадлежит исходному вводу; поздний GET не заменяет её при восстановлении. */
export function useDurableDraft<T>(
  draftKey: string,
  value: T,
  restore: (value: T) => void,
  source?: DraftBase,
) {
  const initialSource = useRef(source);
  const apply = useRef(restore);
  apply.current = restore;
  const [base, setBase] = useState<DraftBase | null>(
    source ? { id: source.id, updatedAt: source.updatedAt } : null,
  );
  const [needsDecision, setNeedsDecision] = useState(false);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setReady(false);
    void (async () => {
      try {
        const owner = await requestTicket();
        const row = await offlineDB.drafts.get(`${owner.owner}:${draftKey}`);
        // Связь формы сохранена атомарно с outbox ДО отправки, а не поздним autosave.
        const bound = (
          await offlineDB.outbox
            .where('owner')
            .equals(owner.owner ?? '')
            .filter((intent) => intent.formKey === draftKey && intent.formValue !== undefined)
            .sortBy('createdAt')
        ).at(-1);
        await assertIdentity(owner);
        if (active && bound?.formValue && typeof bound.formValue === 'object') {
          apply.current({ ...bound.formValue, idempotencyKey: bound.id } as T);
        } else if (active && row) {
          const envelope = DraftEnvelope.safeParse(row.data);
          apply.current((envelope.success ? envelope.data.value : row.data) as T);
          if (initialSource.current) {
            const saved = envelope.success ? envelope.data.base : null;
            const matches = saved?.id === initialSource.current.id;
            setBase(matches ? saved : null);
            setNeedsDecision(!matches);
          }
        }
      } catch (error) {
        if (active)
          setProblem(
            error instanceof LocalFailure
              ? localMessage(error)
              : 'Не удалось прочитать черновик на устройстве.',
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
    // Источник фиксируется при открытии формы; обновление серверной карточки его не подменяет.
  }, [draftKey]);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const owner = await requestTicket();
          if (!active) return;
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
            if (!active) return;
            await offlineDB.drafts.put({
              key: `${owner.owner}:${draftKey}`,
              owner: owner.owner ?? '',
              data: { format: 1, value, base },
              updatedAt: Date.now(),
            });
          });
          if (active) setProblem(null);
        } catch (error) {
          if (!active) return;
          setProblem(
            error instanceof Error && /Quota/.test(error.name)
              ? 'Черновик не сохранён: на устройстве недостаточно места. Оставьте форму открытой.'
              : 'Не удалось сохранить черновик на устройстве. Оставьте форму открытой.',
          );
          changed('storage-error');
        }
      })();
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [draftKey, value, base, ready]);
  return {
    problem,
    base,
    ready,
    needsDecision,
    acceptBase: () => {
      if (!source) return;
      setBase({ id: source.id, updatedAt: source.updatedAt });
      setNeedsDecision(false);
    },
  };
}
export async function clearDraft(key: string) {
  const owner = await requestTicket();
  await offlineDB.transaction(
    'rw',
    offlineDB.identity,
    offlineDB.drafts,
    offlineDB.outbox,
    async () => {
      await assertIdentity(owner);
      await offlineDB.drafts.delete(`${owner.owner}:${key}`);
      await offlineDB.outbox
        .where('owner')
        .equals(owner.owner ?? '')
        .filter((row) => row.formKey === key)
        .modify((row) => {
          delete row.formKey;
          delete row.formValue;
        });
    },
  );
}
