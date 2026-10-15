import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { useToast } from '../ui/Toast.tsx';
import { FeedTaskCard, type TimedTask, type Today } from './api.ts';
import { MoveTaskSheet } from './MoveTaskSheet.tsx';
import { OperationNotice, type TaskOperation, useTaskOperation } from './operation.tsx';
import { PlanRows } from './PlanRows.tsx';
import { emptyDays, overdueLabel, planDay } from './plan.ts';
import { uniqueTasks, usePlan } from './queries.ts';
import { LoadMore, QueryNotice } from './TasksScreen.tsx';

export function PlanFeed({ house }: { house: string | null }) {
  const { me } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const query = usePlan(house);
  const key = ['tasks', me.id, house, 'plan', scope];
  const scrollKey = useMemo(
    () => ['tasks', me.id, house, 'plan', scope, 'scroll'],
    [me.id, house, scope],
  );
  useQuery<number>({ queryKey: scrollKey, enabled: false, gcTime: 5 * 60_000 });
  const cachedToday = useQuery<Today>({
    queryKey: ['tasks', me.id, house, 'today', scope],
    enabled: false,
  });
  const today = query.data ? todayIn(query.data.pages[0]?.timeZone ?? 'UTC') : '';
  const overdue =
    cachedToday.data?.tasks.filter(
      (card) => (card.planOn && card.planOn < today) || (card.dueOn && card.dueOn < today),
    ).length ?? 0;
  const [moving, setMoving] = useState<FeedTaskCard | null>(null);
  const last = useRef<{
    original: FeedTaskCard;
    date: string | null;
    scope: 'this' | 'following';
    undo?: boolean;
    complete?: boolean;
  } | null>(null);
  const toast = useToast();
  const sentinel = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  useLayoutEffect(() => {
    const y = client.getQueryData<number>(scrollKey);
    const frame = requestAnimationFrame(() => {
      if (y !== undefined) window.scrollTo(0, y);
    });
    return () => cancelAnimationFrame(frame);
  }, [client, scrollKey]);
  const remember = () => client.setQueryData(scrollKey, window.scrollY);
  const apply = (card: FeedTaskCard) => {
    client.setQueryData(key, (data: typeof query.data) =>
      data
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              days: page.days.map((day) => ({
                ...day,
                tasks: [
                  ...day.tasks.filter((task) => task.id !== card.id),
                  ...(card.planOn === day.date && ['open', 'waiting'].includes(card.status)
                    ? [card]
                    : []),
                ].sort(
                  (a, b) =>
                    (a.planTime ?? '').localeCompare(b.planTime ?? '') || a.id.localeCompare(b.id),
                ),
              })),
              undated: [
                ...page.undated.filter((task) => task.id !== card.id),
                ...(!card.planOn && ['open', 'waiting'].includes(card.status) ? [card] : []),
              ],
            })),
          }
        : data,
    );
  };
  function finished(result?: TimedTask, queued?: TaskOperation) {
    const action = last.current;
    if (!action) return;
    const card = FeedTaskCard.strip().parse({
      ...action.original,
      ...(queued?.body ?? {}),
      ...(result ?? {}),
    });
    apply(card);
    setMoving(null);
    if (action.undo) {
      toast.show({ message: action.complete ? 'Выполнение отменено' : 'Перенос отменён' });
      return;
    }
    const until = action.complete && result ? result.undoUntil : performance.now() + 7000;
    toast.show({
      message: action.complete
        ? 'Дело выполнено'
        : card.planOn
          ? `Перенесено на ${planDay(card.planOn).replace(/^./, (letter) => letter.toLowerCase())}`
          : 'Перенесено в «Без даты»',
      ...(result ? {} : { detail: 'Сохранено на устройстве. Отправим при появлении сети.' }),
      durationMs: Math.max(1, until - performance.now()),
      ...(!action.complete || (result?.completionEventId && until > performance.now())
        ? {
            action: {
              label: 'Отменить',
              onClick: () => {
                if (performance.now() >= until) return;
                last.current = {
                  ...action,
                  original: card,
                  undo: true,
                  date: action.original.planOn,
                };
                void operation.run(
                  action.complete
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
                          expectedUpdatedAt: card.updatedAt,
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
  useEffect(() => {
    // Изменение высоты страницы тоже порождает scroll: оно не должно загружать месяцы пустых дней.
    let nearEnd = false;
    let requested = false;
    const load = () => {
      if (nearEnd && armed.current && query.hasNextPage && !query.isFetching && !requested) {
        requested = true;
        armed.current = false;
        void query.fetchNextPage();
      }
    };
    const onGesture = () => {
      armed.current = true;
      load();
    };
    const onKey = (event: KeyboardEvent) => {
      if (['PageDown', 'End', 'ArrowDown', ' '].includes(event.key)) onGesture();
    };
    window.addEventListener('wheel', onGesture, { passive: true });
    window.addEventListener('touchmove', onGesture, { passive: true });
    window.addEventListener('keydown', onKey);
    const observer = new IntersectionObserver(
      ([entry]) => {
        nearEnd = !!entry?.isIntersecting;
        load();
      },
      { rootMargin: '0px 0px 160px 0px' },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => {
      window.removeEventListener('wheel', onGesture);
      window.removeEventListener('touchmove', onGesture);
      window.removeEventListener('keydown', onKey);
      observer.disconnect();
    };
  }, [query.hasNextPage, query.isFetching, query.fetchNextPage]);
  const days = new Map<string, Map<string, FeedTaskCard>>();
  for (const page of query.data?.pages ?? [])
    for (const day of page.days) {
      const tasks = days.get(day.date) ?? new Map<string, FeedTaskCard>();
      for (const card of day.tasks) tasks.set(card.id, card);
      days.set(day.date, tasks);
    }
  const groups: { from: string; until: string; tasks: FeedTaskCard[] }[] = [];
  for (const [date, tasks] of days) {
    const previous = groups.at(-1);
    if (!tasks.size && previous && !previous.tasks.length) previous.until = date;
    else groups.push({ from: date, until: date, tasks: [...tasks.values()] });
  }
  const undated = uniqueTasks(query.data?.pages.flatMap((page) => page.undated) ?? []);
  const rows = (tasks: FeedTaskCard[], label: string) => (
    <PlanRows
      tasks={tasks}
      label={label}
      today={today}
      pending={operation.pending}
      move={(card) => {
        operation.setError(null);
        setMoving(card);
      }}
      remember={remember}
      complete={(card) => {
        last.current = { original: card, date: card.planOn, scope: 'this', complete: true };
        void operation.run({
          path: `tasks/${card.id}/status`,
          body: { status: 'done', expectedUpdatedAt: card.updatedAt },
          keyed: true,
        });
      }}
    />
  );
  const hasDated = groups.some((group) => group.tasks.length);
  return (
    <>
      <QueryNotice query={query} />
      {!moving ? <OperationNotice operation={operation} /> : null}
      {overdue > 0 ? (
        <Link
          className="text-button plan-overdue"
          to={house ? `/today?householdId=${house}` : '/today'}
        >
          {overdueLabel(overdue)}
        </Link>
      ) : null}
      {query.data && !hasDated ? <p className="muted">На две недели вперёд дел нет</p> : null}
      {hasDated
        ? groups.map((group) =>
            group.tasks.length ? (
              <section className="section plan-day" key={group.from}>
                <h2 className="plan-day__title">{planDay(group.from, today)}</h2>
                {rows(group.tasks, `Дела ${group.from}`)}
              </section>
            ) : (
              <p className="muted plan-empty-days" key={group.from}>
                {emptyDays(group.from, group.until)}
              </p>
            ),
          )
        : null}
      <div ref={sentinel} className="plan-sentinel" />
      <LoadMore query={query} label="Показать следующие дни" />
      {undated.length ? (
        <details className="plan-undated">
          <summary>Без даты · {undated.length}</summary>
          {rows(undated, 'Дела без даты')}
        </details>
      ) : null}
      {moving ? (
        <MoveTaskSheet
          key={moving.id}
          card={moving}
          timeZone={query.data?.pages[0]?.timeZone ?? me.timeZone}
          pending={operation.pending}
          error={operation.error}
          close={() => setMoving(null)}
          move={(date, repeatScope) => {
            last.current = { original: moving, date, scope: repeatScope };
            void operation.run({
              path: `tasks/${moving.id}`,
              method: 'PATCH',
              keyed: true,
              body: {
                planOn: date,
                ...(date ? {} : { planTime: null }),
                repeatScope,
                expectedUpdatedAt: moving.updatedAt,
              },
            });
          }}
        />
      ) : null}
    </>
  );
}
