import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import type { Scope } from '../access/scope.ts';
import type { Visibility } from '../access/visibility.ts';
import { useAiStatus } from '../ai/AiCapture.tsx';
import { useAction } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { uuid } from '../offline/uuid.ts';
import { useFeedSummary } from '../tasks/feed-pane.tsx';
import { countWord, plural } from '../ui/format.ts';
import { useToast } from '../ui/Toast.tsx';
import { useOperationKey } from '../ui/useOperationKey.ts';
import { useDictation } from '../voice/Dictation.tsx';
import { appendDictation } from '../voice/recognition.ts';
import { dictatedDrafts, type ShoppingDraft } from '../voice/shopping-dictation.ts';
import { fetchShopping, patchShopping, type ShoppingCard, shoppingAction } from './api.ts';
import { shoppingBatch } from './batch.ts';
import { quantityStep } from './quantity.ts';
import { openCount } from './shopping-list.ts';

/** Список покупок по режиму и дому, сводка для ленты и обновление после правок. */
export function useShoppingFeed(
  scope: Scope,
  house: string,
  trash: boolean,
  selectedList: 'household' | 'personal',
) {
  const { me } = useHousehold();
  const client = useQueryClient();
  const mode = scope === 'shared' ? 'household' : scope;
  const account = me.id;
  const query = useInfiniteQuery({
    queryKey: ['shopping', me.id, scope, house, trash],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      fetchShopping(mode, house || null, trash, pageParam, signal),
    getNextPageParam: (last, pages) => (last.length >= 100 ? pages.length * 100 : undefined),
  });
  const refresh = () => client.invalidateQueries({ queryKey: ['shopping', account] });
  const settle = async () => {
    await client.cancelQueries({ queryKey: ['shopping', account] });
    await refresh();
  };
  const all = query.data?.pages.flat() ?? [];
  useFeedSummary(
    query.data && !query.error ? openCount(all, selectedList) : undefined,
    query.error
      ? 'Не удалось загрузить покупки'
      : query.isPending
        ? 'Загружаем…'
        : selectedList === 'personal'
          ? 'в личном списке'
          : 'в общем списке',
    !query.isPending,
    house || null,
  );
  return { query, all, refresh, settle };
}

/** «Куплено» и шаг количества у строки списка, с отменой через уведомление. */
export function useShoppingRowActions(refresh: () => Promise<void>) {
  const toast = useToast();
  const action = useAction();
  const toggleKey = useOperationKey();
  const quantityKey = useOperationKey();
  function toggle(card: ShoppingCard) {
    const bought = !card.boughtAt;
    const payload = { id: card.id, bought, base: card.updatedAt };
    void action.run(async () => {
      const result = await shoppingAction(card, 'bought', toggleKey(payload), bought);
      await refresh();
      toast.show({
        message: bought ? 'Куплено' : 'Вернули в список',
        action: {
          label: 'Отменить',
          onClick: () => {
            void shoppingAction(result, 'bought', uuid(), !bought)
              .then(refresh)
              .catch(() =>
                toast.show({ message: 'Не удалось отменить. Обновите список и повторите.' }),
              );
          },
        },
      });
    });
  }
  function step(card: ShoppingCard, delta: number) {
    const quantity = quantityStep(card.quantity, delta);
    if (!quantity) return;
    const body = { quantity, expectedUpdatedAt: card.updatedAt };
    void action.run(async () => {
      await patchShopping(card.id, {
        ...body,
        idempotencyKey: quantityKey({ id: card.id, ...body }),
      });
      await refresh();
    });
  }
  return { action, toggle, step };
}

/**
 * Строка быстрого добавления: ввод, диктовка, черновики и пачка позиций с отменой.
 * Повтор той же строки после сбоя отправляет ту же пачку — без дублей.
 */
export function useShoppingQuickAdd({
  house,
  place,
  refresh,
  settle,
}: {
  house: string;
  place: Visibility;
  refresh: () => Promise<void>;
  settle: () => Promise<void>;
}) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [drafts, setDrafts] = useState<ShoppingDraft[] | null>(null);
  const ai = useAiStatus(house || null);
  // Надиктованная строка без «Разобрать» (отказ от ИИ, сбой, предел) делится на позиции как в SHOP-4.
  const [dictated, setDictated] = useState(false);
  // SHOP-4: надиктованное сначала показывается черновиками, ничего не добавляется само.
  // Фраза без позиций («и», «, ,», тишина) не открывает пустой лист, а просит повторить.
  const dictation = useDictation((text) => {
    // D25: при включённом ИИ фраза остаётся в строке до явного «Разобрать» и согласия.
    if (ai.data?.enabled) {
      if (!text.trim()) return 'Ничего не расслышали. Скажите ещё раз.';
      setTitle((current) => appendDictation(current, text));
      setDictated(true);
      return undefined;
    }
    const result = dictatedDrafts(text);
    if ('error' in result) return result.error;
    setDrafts(result.drafts);
    return undefined;
  });
  const batch = useRef<{ fingerprint: string; value: ReturnType<typeof shoppingBatch> } | null>(
    null,
  );
  const state = useAction();
  function add(event: FormEvent) {
    event.preventDefault();
    if (state.disabled) return;
    const value = title.trim();
    if (!value) return;
    if (dictated) {
      const result = dictatedDrafts(value);
      if (!('error' in result)) {
        setDrafts(result.drafts);
        setTitle('');
        setDictated(false);
        return;
      }
    }
    const result = dictatedDrafts(value);
    if ('error' in result) {
      state.setError(new Error(result.error));
      return;
    }
    const fingerprint = JSON.stringify([value, place, house]);
    if (batch.current?.fingerprint !== fingerprint)
      batch.current = { fingerprint, value: shoppingBatch(result.drafts, place, house || null) };
    const current = batch.current.value;
    void state.run(async () => {
      try {
        const { added, duplicates } = await current.add();
        setTitle('');
        batch.current = null;
        toast.show({
          message: `${plural(added, ['Добавлена', 'Добавлены', 'Добавлено'])} ${countWord(added, ['покупка', 'покупки', 'покупок'])}${duplicates ? `. Пропущено дублей: ${duplicates}` : ''}`,
          ...(added
            ? {
                action: {
                  label: 'Отменить',
                  onClick: () => {
                    void current
                      .undo()
                      .then(refresh)
                      .catch(() =>
                        toast.show({
                          message: 'Не удалось отменить покупки. Повторите отмену.',
                          action: {
                            label: 'Отменить',
                            onClick: () => {
                              void state.run(async () => {
                                await current.undo();
                                await refresh();
                              });
                            },
                          },
                        }),
                      );
                  },
                },
              }
            : {}),
        });
      } finally {
        await settle();
      }
    });
  }
  return { title, setTitle, dictated, setDictated, drafts, setDrafts, ai, dictation, state, add };
}

export type ShoppingQuickAddState = ReturnType<typeof useShoppingQuickAdd>;
