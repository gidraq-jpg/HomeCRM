import { useRef, useState } from 'react';
import { useToast } from '../ui/Toast.tsx';
import { fetchTask, TaskCard, TaskError, type TimedTask } from './api.ts';
import { type TaskOperation, useTaskOperation } from './operation.tsx';
import { planDay } from './plan.ts';

/** Общие действия лент: штатная очередь, конфликты версий и ограниченная отмена. */
export function useFeedActions<T extends TaskCard>(apply: (card: T) => void) {
  const [moving, setMoving] = useState<T | null>(null);
  const last = useRef<{
    original: T;
    scope: 'this' | 'following';
    kind: 'move' | 'complete' | 'resume';
    undo?: boolean;
  } | null>(null);
  const toast = useToast();
  const completions = useRef(new Map<string, TimedTask>());
  const checkingResume = useRef(false);
  const [resumePending, setResumePending] = useState(false);
  const localVersions = useRef(new Map<string, { shown: string; base: string }>());
  const version = (card: T) => {
    const local = localVersions.current.get(card.id);
    return local?.shown === card.updatedAt ? local.base : card.updatedAt;
  };
  function finished(result?: TimedTask, queued?: TaskOperation) {
    const action = last.current;
    if (!action) return;
    const card = {
      ...action.original,
      ...TaskCard.strip().parse({
        ...action.original,
        ...(queued?.body ?? {}),
        ...(queued && action.kind === 'complete' && !action.undo
          ? { updatedAt: new Date().toISOString() }
          : {}),
        ...(result ?? {}),
      }),
    };
    if (queued)
      localVersions.current.set(card.id, { shown: card.updatedAt, base: version(action.original) });
    else localVersions.current.delete(card.id);
    if (action.kind === 'complete' && result && !action.undo)
      completions.current.set(card.id, result);
    else completions.current.delete(card.id);
    apply(card);
    setMoving(null);
    if (action.undo || action.kind === 'resume') {
      toast.show({
        message:
          action.kind === 'resume'
            ? 'Дело возобновлено'
            : action.kind === 'complete'
              ? 'Выполнение отменено'
              : 'Перенос отменён',
        ...(queued ? { detail: 'Сохранено на устройстве. Отправим при появлении сети.' } : {}),
      });
      return;
    }
    const until =
      action.kind === 'complete' && result ? result.undoUntil : performance.now() + 7000;
    toast.show({
      message:
        action.kind === 'complete'
          ? 'Дело выполнено'
          : card.planOn
            ? `Перенесено на ${planDay(card.planOn).replace(/^./, (letter) => letter.toLowerCase())}`
            : 'Перенесено в «Без даты»',
      ...(result ? {} : { detail: 'Сохранено на устройстве. Отправим при появлении сети.' }),
      durationMs: Math.max(1, until - performance.now()),
      ...(action.kind === 'move' || (result?.completionEventId && until > performance.now())
        ? {
            action: {
              label: 'Отменить',
              onClick: () => {
                if (performance.now() >= until) return;
                last.current = { ...action, original: card, undo: true };
                void operation.run(
                  action.kind === 'complete'
                    ? {
                        path: `tasks/${card.id}/undo`,
                        body: { eventId: result?.completionEventId },
                      }
                    : {
                        path: `tasks/${card.id}`,
                        method: 'PATCH',
                        keyed: true,
                        body: {
                          planOn: action.original.planOn,
                          planTime: action.original.planTime,
                          repeatScope: action.scope,
                          expectedUpdatedAt: version(card),
                        },
                      },
                );
              },
            },
          }
        : {}),
    });
  }
  const operation = useTaskOperation(finished, (request) => finished(undefined, request));
  const status = (card: T, value: 'open' | 'done') => {
    last.current = {
      original: card,
      scope: 'this',
      kind: value === 'done' ? 'complete' : 'resume',
    };
    void operation.run({
      path: `tasks/${card.id}/status`,
      body: { status: value, expectedUpdatedAt: version(card) },
      keyed: true,
    });
  };
  return {
    operation: { ...operation, pending: operation.pending || resumePending },
    moving,
    close: () => setMoving(null),
    startMove: (card: T) => {
      operation.setError(null);
      setMoving(card);
    },
    complete: (card: T) => status(card, 'done'),
    resume: async (card: T) => {
      if (checkingResume.current || operation.pending) return;
      let completion = completions.current.get(card.id);
      if (card.repeatRule && card.status === 'done' && !completion) {
        checkingResume.current = true;
        setResumePending(true);
        try {
          // После смены ленты или перезагрузки окно берём из Date сервера,
          // не возвращаем служебные монотонные часы в кэш ленты.
          completion = await fetchTask(card.id);
          if (completion.status !== 'done') {
            operation.setError(new TaskError(409, { code: 'CONFLICT' }));
            return;
          }
        } catch (error) {
          operation.setError(error);
          return;
        } finally {
          checkingResume.current = false;
          setResumePending(false);
        }
      }
      if (
        card.repeatRule &&
        completion?.completionEventId &&
        performance.now() < completion.undoUntil
      ) {
        last.current = { original: card, scope: 'this', kind: 'complete', undo: true };
        void operation.run({
          path: `tasks/${card.id}/undo`,
          body: { eventId: completion.completionEventId },
        });
      } else status(card, 'open');
    },
    move: (date: string | null, repeatScope: 'this' | 'following') => {
      if (!moving) return;
      last.current = { original: moving, scope: repeatScope, kind: 'move' };
      void operation.run({
        path: `tasks/${moving.id}`,
        method: 'PATCH',
        keyed: true,
        body: {
          planOn: date,
          ...(date ? {} : { planTime: null }),
          repeatScope,
          expectedUpdatedAt: version(moving),
        },
      });
    },
  };
}
