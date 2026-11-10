import '../styles/plan-diary.css';
import { localDate } from '@homecrm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { todayIn } from '../objects/dates.ts';
import { Link } from '../shell/motion.tsx';
import { plural } from '../ui/format.ts';
import { MotionGroups } from '../ui/MotionGroups.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { FeedTaskCard } from './api.ts';
import { useFeedPane, useFeedSummary } from './feed-pane.tsx';
import { MoveTaskSheet } from './MoveTaskSheet.tsx';
import { OperationNotice } from './operation.tsx';
import { PlanRows } from './PlanRows.tsx';
import { PlanWeek } from './PlanWeek.tsx';
import { emptyDays, isOverdue, overdueLabel, planDay } from './plan.ts';
import { uniqueTasks, usePlan, useToday } from './queries.ts';
import { LoadMore, QueryNotice } from './TasksScreen.tsx';
import { useFeedActions } from './useFeedActions.ts';

export function PlanFeed({ house }: { house: string | null }) {
  const { me } = useHousehold();
  const [params, setParams] = useSearchParams();
  const undatedOpen = params.get('undated') === '1';
  const setUndated = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('undated', '1');
    else next.delete('undated');
    setParams(next, { replace: !open });
  };
  const list = useRef<HTMLDivElement>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!targetDate) return;
    let cancelled = false;
    const frame = requestAnimationFrame(async () => {
      await Promise.allSettled(
        (list.current?.getAnimations({ subtree: true }) ?? []).map(
          (animation) => animation.finished,
        ),
      );
      if (cancelled) return;
      const target = [
        ...(list.current?.querySelectorAll<HTMLElement>('[data-plan-from]') ?? []),
      ].find(
        (el) =>
          (el.dataset.planFrom ?? '') <= targetDate &&
          (el.dataset.planUntil ?? el.dataset.planFrom ?? '') >= targetDate,
      );
      const nav = document.querySelector<HTMLElement>('.plan-week');
      if (target && nav)
        window.scrollTo(
          0,
          window.scrollY +
            target.getBoundingClientRect().top -
            parseFloat(getComputedStyle(nav).top) -
            nav.offsetHeight -
            8,
        );
      setTargetDate(null);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [targetDate]);
  const prepend = async () => {
    const anchor = [
      ...(list.current?.querySelectorAll<HTMLElement>('[data-plan-from]') ?? []),
    ].find(
      (el) =>
        el.getBoundingClientRect().bottom >
        (document.querySelector('.plan-week')?.getBoundingClientRect().bottom ?? 200),
    );
    const date = anchor?.dataset.planFrom;
    const top = anchor?.getBoundingClientRect().top;
    await query.fetchPreviousPage();
    requestAnimationFrame(async () => {
      await Promise.allSettled(
        (list.current?.getAnimations({ subtree: true }) ?? []).map(
          (animation) => animation.finished,
        ),
      );
      const next = [
        ...(list.current?.querySelectorAll<HTMLElement>('[data-plan-from]') ?? []),
      ].find(
        (el) =>
          date &&
          (el.dataset.planFrom ?? '') <= date &&
          (el.dataset.planUntil ?? el.dataset.planFrom ?? '') >= date,
      );
      if (next && top !== undefined) window.scrollBy(0, next.getBoundingClientRect().top - top);
    });
  };
  const { scope } = useScope();
  const client = useQueryClient();
  const query = usePlan(house);
  const active = useFeedPane()?.active ?? true;
  const count = query.data
    ? uniqueTasks(
        query.data.pages.flatMap((page) => [
          ...page.days.flatMap((day) => day.tasks),
          ...page.undated,
        ]),
      ).length
    : undefined;
  useFeedSummary(
    query.error ? undefined : count || undefined,
    query.error
      ? 'Не удалось загрузить план'
      : count === undefined
        ? 'Загружаем…'
        : count === 0
          ? 'на две недели дел нет'
          : plural(count, ['дело', 'дела', 'дел']),
    !query.isPending,
  );
  const key = ['tasks', me.id, house, 'plan', scope];
  const scrollKey = useMemo(
    () => ['tasks', me.id, house, 'plan', scope, 'scroll'],
    [me.id, house, scope],
  );
  useQuery<number>({ queryKey: scrollKey, enabled: false, gcTime: 5 * 60_000 });
  const cachedToday = useToday(house);
  const today = query.data ? todayIn(query.data.pages[0]?.timeZone ?? 'UTC') : '';
  const overdue = cachedToday.data?.tasks.filter((card) => isOverdue(card, today)).length ?? 0;
  const sentinel = useRef<HTMLDivElement>(null);
  const armed = useRef(false);
  useLayoutEffect(() => {
    if (!active) return;
    const y = client.getQueryData<number>(scrollKey);
    const frame = requestAnimationFrame(() => {
      if (y !== undefined) window.scrollTo(0, y);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, client, scrollKey]);
  const initialized = useRef(false);
  useEffect(() => {
    if (!active || !query.data || initialized.current) return;
    initialized.current = true;
    if (client.getQueryData<number>(scrollKey) !== undefined) return;
    void query.fetchPreviousPage().then(() => setTargetDate(today));
  }, [active, query.data, query.fetchPreviousPage, client, scrollKey, today]);
  const remember = () => client.setQueryData(scrollKey, window.scrollY);
  const apply = (card: FeedTaskCard) => {
    card = FeedTaskCard.strip().parse(card);
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
                  ...((card.status === 'done' && card.doneAt
                    ? localDate(new Date(card.doneAt), page.timeZone)
                    : card.planOn) === day.date
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
  const actions = useFeedActions(apply);
  const { operation, moving } = actions;
  useEffect(() => {
    if (!active) return;
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
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              nearEnd = !!entry?.isIntersecting;
              load();
            },
            { rootMargin: '0px 0px 160px 0px' },
          );
    if (sentinel.current) observer?.observe(sentinel.current);
    return () => {
      window.removeEventListener('wheel', onGesture);
      window.removeEventListener('touchmove', onGesture);
      window.removeEventListener('keydown', onKey);
      observer?.disconnect();
    };
  }, [active, query.hasNextPage, query.isFetching, query.fetchNextPage]);
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
    if (
      !tasks.size &&
      previous &&
      !previous.tasks.length &&
      date !== today &&
      previous.from !== today &&
      date < today === previous.from < today
    )
      previous.until = date;
    else groups.push({ from: date, until: date, tasks: [...tasks.values()] });
  }
  const undated = uniqueTasks(query.data?.pages.flatMap((page) => page.undated) ?? []);
  const rows = (tasks: FeedTaskCard[], label: string) => (
    <PlanRows
      tasks={tasks}
      label={label}
      today={today}
      pending={operation.pending}
      completionFailed={!!operation.error || !!operation.confirmation}
      move={(card) => {
        if (undatedOpen) setUndated(false);
        actions.startMove(card);
      }}
      remember={remember}
      complete={actions.complete}
      resume={actions.resume}
      resumeBlocked={actions.resumeBlocked}
      undatedAge={label === 'Дела без даты'}
    />
  );
  const hasDated = groups.length > 0;
  const jump = async (date: string) => {
    try {
      let data = query.data;
      while (data?.pages[0] && date < data.pages[0].from && data.pages[0].prevCursor) {
        const result = await query.fetchPreviousPage();
        if (result.isError) throw result.error;
        data = result.data;
      }
      while (
        data?.pages.at(-1)?.days.at(-1) &&
        date > (data.pages.at(-1)?.days.at(-1)?.date ?? '') &&
        data.pages.at(-1)?.nextCursor
      ) {
        const result = await query.fetchNextPage();
        if (result.isError) throw result.error;
        data = result.data;
      }
      setTargetDate(date);
    } catch (error) {
      operation.setError(error);
    }
  };
  useEffect(() => {
    if (!active) return;
    const up = () => {
      const first = list.current?.querySelector('[data-plan-from]');
      if (
        first &&
        first.getBoundingClientRect().top > 200 &&
        query.hasPreviousPage &&
        !query.isFetching
      )
        void prepend();
    };
    window.addEventListener('wheel', up, { passive: true });
    window.addEventListener('touchmove', up, { passive: true });
    return () => {
      window.removeEventListener('wheel', up);
      window.removeEventListener('touchmove', up);
    };
  });
  return (
    <>
      {today ? (
        <PlanWeek
          today={today}
          active={active}
          counts={new Map([...days].map(([date, cards]) => [date, cards.size]))}
          jump={jump}
          undated={undated.length}
          openUndated={() => setUndated(true)}
        />
      ) : null}
      <QueryNotice query={query} />
      {query.hasPreviousPage ? (
        <button
          className="text-button"
          type="button"
          disabled={query.isFetching}
          onClick={() => void prepend()}
        >
          Показать предыдущие дни
        </button>
      ) : null}
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
      <div ref={list} className="plan-diary-days">
        <MotionGroups
          version={groups
            .flatMap((group) => group.tasks.map((card) => card.id + card.status))
            .join(',')}
        >
          {hasDated
            ? groups.map((group) =>
                group.tasks.length ? (
                  <section
                    className="section plan-day"
                    key={group.from}
                    data-motion-key={group.from}
                    data-plan-from={group.from}
                    data-plan-until={group.until}
                  >
                    <h2 className="plan-day__title">
                      {planDay(group.from, today)}
                      {group.from <= today
                        ? ` · ${group.tasks.filter((t) => t.status === 'done').length} из ${group.tasks.length}`
                        : ''}
                    </h2>
                    {rows(group.tasks, `Дела ${group.from}`)}
                  </section>
                ) : (
                  <p
                    className="muted plan-empty-days"
                    key={group.from}
                    data-plan-from={group.from}
                    data-plan-until={group.until}
                  >
                    {emptyDays(group.from, group.until).replace(
                      'свободно',
                      group.until < today ? 'без записей' : 'свободно',
                    )}
                  </p>
                ),
              )
            : null}
        </MotionGroups>
      </div>
      <div ref={sentinel} className="plan-sentinel" />
      <LoadMore
        query={query}
        label="Показать следующие дни"
        onFocus={() => {
          if (query.hasNextPage && !query.isFetching) void query.fetchNextPage();
        }}
      />
      {active && undatedOpen && !moving ? (
        <Sheet
          open
          historyEntry
          onOpenChange={setUndated}
          title="Без даты"
          description="Назначьте день делам, которые ждут своего времени."
        >
          {undated.length ? (
            rows(undated, 'Дела без даты')
          ) : (
            <p className="muted">Дел без даты нет</p>
          )}
        </Sheet>
      ) : null}
      {moving ? (
        <MoveTaskSheet
          key={moving.id}
          card={moving}
          timeZone={query.data?.pages[0]?.timeZone ?? me.timeZone}
          pending={operation.pending}
          error={operation.error}
          close={actions.close}
          move={actions.move}
        />
      ) : null}
    </>
  );
}
