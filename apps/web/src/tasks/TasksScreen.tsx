import { Clock } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { RadarRows } from '../deadlines/RadarScreen.tsx';
import { ReadingsWindowsFromRows } from '../deadlines/ReadingsWindowCards.tsx';
import { buildRows, filterRows } from '../deadlines/radar.ts';
import { useHouseNames } from '../deadlines/useHouseNames.ts';
import { isOpenWindow } from '../deadlines/utility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { InboxLink } from '../inbox/InboxScreen.tsx';
import { listScopeOf } from '../notes/queries.ts';
import { PushCard } from '../notifications/PushCard.tsx';
import { useSettings } from '../notifications/queries.ts';
import { todayIn } from '../objects/dates.ts';
import { useQueue } from '../offline/OfflinePanel.tsx';
import { Link } from '../shell/motion.tsx';
import { FirstRunCard } from '../templates/FirstRunCard.tsx';
import { FilterButton, FilterTag } from '../ui/CompactFilters.tsx';
import { ContentMotion } from '../ui/ContentMotion.tsx';
import { EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { plural } from '../ui/format.ts';
import { ListSkeleton } from '../ui/ListSkeleton.tsx';
import { MotionGroups } from '../ui/MotionGroups.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { RollingNumber } from '../ui/RollingNumber.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { FeedTaskCard, type TaskCard, type TaskFilters, type Today } from './api.ts';
import { taskError } from './errors.ts';
import { useFeedPane, useFeedSummary } from './feed-pane.tsx';
import { SelectField } from './fields.tsx';
import { MoveTaskSheet } from './MoveTaskSheet.tsx';
import { OperationNotice } from './operation.tsx';
import { RecordPicker } from './options.tsx';
import { PlanFeed } from './PlanFeed.tsx';
import { PlanRows } from './PlanRows.tsx';
import { overdueDays } from './plan.ts';
import { uniqueTasks, usePlan, useTaskList, useToday } from './queries.ts';
import { queuedStatus } from './queued-status.ts';
import { STATUS_LABELS } from './TaskForm.tsx';
import { TaskRows } from './TaskRows.tsx';
import { TaskTabs } from './TaskTabs.tsx';
import { TodayHero, useTodayGreeting } from './TodayHero.tsx';
import { useFeedActions } from './useFeedActions.ts';
import './today.css';

type View = 'today' | 'plan' | 'all';
export function TasksScreen({ view = 'today' }: { view?: View }) {
  const { me, householdId } = useHousehold();
  const [params] = useSearchParams();
  const house = me.roles.some((role) => role.householdId === params.get('householdId'))
    ? params.get('householdId')
    : householdId;
  return view === 'today' ? (
    <TodayFeed key={house} house={house} />
  ) : view === 'plan' ? (
    <TasksPage view="plan" house={house}>
      <PlanFeed key={house} house={house} />
    </TasksPage>
  ) : (
    <AllFeed key={house} house={house} />
  );
}
function TasksPage({
  view,
  house,
  hero,
  eyebrow,
  children,
}: {
  view: View;
  house: string | null;
  hero?: ReactNode;
  eyebrow?: string;
  children: ReactNode;
}) {
  const { me, householdId, isAdmin } = useHousehold();
  const pane = useFeedPane();
  const { scope } = useScope();
  const houseNames = useHouseNames({
    scope: listScopeOf(scope),
    view: 'mine',
    ...(house ? { householdId: house } : {}),
  });
  const [, setParams] = useSearchParams();
  const houseQuery = house && house !== householdId ? `?householdId=${house}` : '';
  const feedTabs = <TaskTabs houseQuery={houseQuery} />;
  const actions = (
    <div className="task-actions">
      <div className="task-actions__help">
        <Link className="text-button" to="/more/spaces">
          Как устроены личное и общее
        </Link>
        {isAdmin ? (
          <Link className="text-button" to="/people/invite">
            Пригласить участника
          </Link>
        ) : null}
      </div>
    </div>
  );
  const content = (
    <>
      {!pane && view !== 'plan' ? feedTabs : null}
      <div className="task-feed-content">
        {scope !== 'all' ? <p className="muted">{EMPTY_SCOPE_EXPLANATION[scope]}</p> : null}
        {me.roles.length > 1 ? (
          <SelectField
            label="Выбранный дом"
            value={house ?? ''}
            onChange={(value) => setParams({ householdId: value })}
            options={me.roles.map((role) => ({
              value: role.householdId,
              label: houseNames(role.householdId),
            }))}
          />
        ) : null}
        {pane && view === 'all' ? hero : null}
        {children}
        {view === 'today' ? actions : null}
      </div>
    </>
  );
  if (pane) return content;
  return (
    <Page
      title={view === 'today' ? 'Сегодня' : view === 'plan' ? 'План' : 'Все дела'}
      eyebrow={eyebrow ?? (view === 'all' ? 'Дела дома и ваши личные' : undefined)}
      heading={
        hero ??
        (view === 'plan' ? (
          <h1 className="visually-hidden">План</h1>
        ) : (
          <>
            <p className="page-heading__eyebrow">Дела дома и ваши личные</p>
            <div className="page-heading__line">
              <h1>Все дела</h1>
            </div>
          </>
        ))
      }
      className={
        view === 'today'
          ? 'today-page'
          : view === 'plan'
            ? 'plan-page'
            : 'studio-list-page all-tasks-page'
      }
      tabs={view === 'plan' ? feedTabs : undefined}
    >
      {view === 'today' ? (
        <div className="studio-panel today-panel" id="today-panel">
          {content}
        </div>
      ) : view === 'all' ? (
        <div className="studio-panel studio-list-panel">{content}</div>
      ) : (
        content
      )}
    </Page>
  );
}
function TodayFeed({ house }: { house: string | null }) {
  const pane = useFeedPane();
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const query = useToday(house);
  const settings = useSettings();
  const plan = usePlan(house);
  const undatedCount = plan.data?.pages[0]?.undated.length ?? 0;
  const loadingFeed = query.isPending || settings.isPending;
  const count = query.data && !query.error ? query.data.tasks.length : undefined;
  const greeting = useTodayGreeting(query.data, query.error, house);
  useFeedSummary(
    count,
    query.error
      ? 'Не удалось загрузить дела'
      : count === undefined
        ? 'Загружаем…'
        : plural(count, ['дело', 'дела', 'дел']),
    !loadingFeed,
    undefined,
    { greeting: `Добрый день, ${greeting.name}` },
  );
  const showMain = settings.data?.todayMainEnabled === true;
  const otherTasks =
    query.data?.tasks.filter((task) => !showMain || task.id !== query.data?.main?.id) ?? [];
  const taskRadar = query.error || query.data?.recalculating ? [] : (query.data?.radar ?? []);
  const actions = useFeedActions<TaskCard>((card) => {
    const moved = FeedTaskCard.strip().parse({ object: null, ...card });
    client.setQueryData<Today>(['tasks', me.id, house, 'today', scope], (data) => {
      if (!data) return data;
      const visible =
        moved.isMain ||
        (moved.planOn && moved.planOn <= data.today) ||
        (moved.dueOn && moved.dueOn < data.today);
      return {
        ...data,
        main: data.main?.id === moved.id ? moved : data.main,
        tasks: [
          ...data.tasks.filter((task) => task.id !== moved.id),
          ...(visible ? [moved] : []),
        ].sort(
          (left, right) =>
            (left.planOn ?? '').localeCompare(right.planOn ?? '') ||
            (left.planTime ?? '').localeCompare(right.planTime ?? '') ||
            left.id.localeCompare(right.id),
        ),
      };
    });
  });
  const { operation, moving } = actions;
  const now = new Date();
  const rows = buildRows(query.data?.radar ?? [], {
    timeZone: query.data?.timeZone ?? 'UTC',
    now,
    today: (query.data?.today ?? '2000-01-01') as ReturnType<
      typeof import('../objects/dates.ts').todayIn
    >,
    titleOf: () => undefined,
    locate: () => undefined,
  });
  const urgent = filterRows(rows, { view: 'mine', scope, meId: me.id }).filter(
    (row) =>
      !isOpenWindow(row) &&
      !query.data?.tasks.some(
        (task) => row.to === `/today/tasks/${task.id}` || task.radarOccurrenceId === row.id,
      ),
  );
  const houseQuery = house && house !== householdId ? `?householdId=${house}` : '';
  return (
    <TasksPage
      view="today"
      house={house}
      hero={<TodayHero data={query.data} error={query.error} house={house} />}
    >
      {loadingFeed ? (
        <div className="today-feed-skeleton">
          <ListSkeleton label="Загружаем дела…" />
        </div>
      ) : (
        <>
          <QueryNotice query={query} />
          {settings.error ? (
            <Notice error>
              Не удалось загрузить настройку главного дела.{' '}
              <button type="button" className="text-button" onClick={() => void settings.refetch()}>
                Повторить загрузку настройки
              </button>
            </Notice>
          ) : null}
          {!loadingFeed && query.data && showMain ? (
            <div className="today-main">
              {query.data.main ? (
                <TaskRows
                  label="Главное дело"
                  tasks={[query.data.main]}
                  radar={taskRadar}
                  today={query.data.today}
                  focus
                  move={actions.startMove}
                  pending={operation.pending}
                />
              ) : (
                <div className="today-main__empty">
                  <h2 className="today-main__label">Что сегодня важнее всего?</h2>
                  <p>
                    Одно дело, которому вы хотите уделить внимание. Выберите его в карточке дела.
                  </p>
                  <div>
                    <Link
                      className="text-button"
                      to={
                        query.data.tasks.length
                          ? `/today/all${houseQuery}`
                          : `/today/new${houseQuery}`
                      }
                    >
                      {query.data.tasks.length ? 'Выбрать главное дело' : 'Добавить дело'}
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ) : null}
          {!query.data ? <InboxLink /> : null}
          <FirstRunCard />
          {!moving ? <OperationNotice operation={operation} /> : null}
          {!loadingFeed && query.data ? (
            <>
              <ReadingsWindowsFromRows rows={rows} />
              {undatedCount > 0 && new Date(`${query.data.today}T12:00:00Z`).getUTCDay() === 0 ? (
                <Link
                  className="plan-review record-card"
                  to={`/today/plan?undated=1${house ? `&householdId=${house}` : ''}`}
                >
                  Разобрать дела без даты: {undatedCount}
                </Link>
              ) : null}
              <div className="today-extra">
                <Section title={`Ещё на сегодня · ${otherTasks.length}`} aside={<InboxLink />}>
                  <TaskRows
                    label="Дела на сегодня"
                    tasks={otherTasks}
                    radar={taskRadar}
                    todayStyle
                    move={actions.startMove}
                    pending={operation.pending}
                    today={query.data.today}
                  />
                </Section>
              </div>
              <p data-motion-target="done" className="task-counts">
                Осталось <RollingNumber value={query.data.tasks.length} /> · Выполнено{' '}
                <RollingNumber value={query.data.completed.length} />
              </p>
              {query.data.completed.length ? (
                <details className="task-completed">
                  <summary>Выполнено сегодня ({query.data.completed.length})</summary>
                  <TaskRows
                    label="Выполненные дела"
                    todayStyle
                    tasks={query.data.completed}
                    today={query.data.today}
                  />
                </details>
              ) : null}
              <Section title="Срочное из радара">
                {urgent.length === 0 ? <p className="muted">Срочного нет.</p> : null}
                <RadarRows rows={urgent.slice(0, 5)} label="Срочные сроки" />
                <Link className="text-button" to="/more/radar" state={{ fromSection: 'today' }}>
                  Весь радар
                </Link>
              </Section>
            </>
          ) : null}
        </>
      )}
      {pane ? (
        <div className="feed-overview">
          <TodayHero data={query.data} error={query.error} house={house} embedded />
        </div>
      ) : null}
      <PushCard />
      {moving && query.data ? (
        <MoveTaskSheet
          key={moving.id}
          card={moving}
          timeZone={query.data.timeZone}
          pending={operation.pending}
          error={operation.error}
          close={actions.close}
          move={(date) => actions.move(date, 'this')}
          thisOnly
        />
      ) : null}
    </TasksPage>
  );
}
function AllFeed({ house }: { house: string | null }) {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const { rows: queued } = useQueue();
  const [filters, setFilters] = useState<TaskFilters>({});
  const [objectOpen, setObjectOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const overdueOnly = params.get('list') === 'overdue';
  const openOnly = params.get('list') === 'open';
  const listHref = (list: string) => {
    const next = new URLSearchParams(params);
    next.set('list', list);
    return `/today/all?${next}`;
  };
  const clearList = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('list');
      next.delete('status');
      return next;
    });
  const selectedStatus = params.get('status') === 'done' ? 'done' : filters.status;
  const pane = useFeedPane();
  const query = useTaskList({ ...filters, status: selectedStatus }, false, house);
  const cachedToday = client.getQueryData<Today>(['tasks', me.id, house, 'today', scope]);
  const timeZone = !house || house === householdId ? me.timeZone : cachedToday?.timeZone;
  const today = timeZone ? todayIn(timeZone) : '';
  const weekEnd = today ? new Date(`${today}T12:00:00Z`) : null;
  if (weekEnd) weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - (weekEnd.getUTCDay() || 7)));
  const end = weekEnd?.toISOString().slice(0, 10) ?? '';
  const ownQueued = queued.filter((intent) => intent.owner === me.id);
  const tasks = uniqueTasks(query.data?.pages.flat() ?? [])
    .map((card) => queuedStatus(card, ownQueued))
    .filter((task) => !house || !task.householdId || task.householdId === house);
  const isActive = (task: TaskCard) => task.status === 'open' || task.status === 'waiting';
  const active = tasks.filter(isActive);
  const overdue = active.filter((task) => overdueDays(task, today) !== null);
  const overdueIds = new Set(overdue.map((task) => task.id));
  const selected = overdueOnly
    ? overdue
    : openOnly
      ? active
      : tasks.filter(
          (task) =>
            selectedStatus ||
            isActive(task) ||
            (timeZone && todayIn(timeZone, new Date(task.updatedAt)) >= today),
        );
  const upcoming = selected.filter((task) => isActive(task) && !overdueIds.has(task.id));
  const groups = [
    { title: 'Просрочено', tasks: overdue },
    { title: 'Эта неделя', tasks: upcoming.filter((task) => task.planOn && task.planOn <= end) },
    { title: 'Позже', tasks: upcoming.filter((task) => task.planOn && task.planOn > end) },
    { title: 'Без даты', tasks: upcoming.filter((task) => !task.planOn) },
    { title: 'Завершённые', tasks: selected.filter((task) => !isActive(task)) },
  ];
  const actions = useFeedActions<TaskCard>((card) => {
    client.setQueriesData<{ pages: TaskCard[][]; pageParams: unknown[] }>(
      { queryKey: ['tasks', me.id, house, 'all'] },
      (data) =>
        data
          ? {
              ...data,
              pages: data.pages.map((page) =>
                page.map((task) => (task.id === card.id ? card : task)),
              ),
            }
          : data,
    );
  });
  const { operation, moving } = actions;
  const activeFilters =
    Number(!!filters.filter) + Number(!!selectedStatus) + Number(!!filters.objectId);
  const hasFilters = activeFilters > 0 || overdueOnly;
  const unfiltered = !filters.filter && !selectedStatus && !filters.objectId;
  const summary = query.data && !query.error && !query.hasNextPage && unfiltered;
  // Число открытых дел называет только шапка (D48); под вкладками остаётся лишь «просрочено».
  useFeedSummary(
    query.data && !query.error ? active.length : undefined,
    query.error
      ? 'Не удалось загрузить дела'
      : query.isPending
        ? 'Загружаем…'
        : query.hasNextPage
          ? 'или больше открытых'
          : plural(active.length, ['открытое', 'открытых', 'открытых']),
    !query.isPending,
  );
  const rows = (items: typeof tasks, title: string) => (
    <PlanRows
      tasks={items}
      label={title}
      today={today}
      pending={operation.pending}
      completionFailed={!!operation.error || !!operation.confirmation}
      dates
      complete={actions.complete}
      resume={actions.resume}
      resumeBlocked={actions.resumeBlocked}
      move={timeZone ? actions.startMove : undefined}
    />
  );
  const overdueLink =
    summary && overdue.length > 0 && !overdueOnly ? (
      <Link className="all-tasks-overdue" to={listHref('overdue')}>
        <span className="today-overdue">
          <Clock size={14} aria-hidden />
          Просрочено · {overdue.length}
        </span>
      </Link>
    ) : null;
  return (
    <TasksPage
      view="all"
      house={house}
      hero={
        pane ? (
          overdueLink
        ) : (
          <div className="studio-list-hero">
            <h1>Все дела</h1>
            {overdueLink}
          </div>
        )
      }
    >
      <div className="compact-filters task-filters">
        <FilterButton count={activeFilters} onClick={() => setObjectOpen(true)} />
        <div className="compact-filters__summary">
          {!hasFilters ? <span className="muted">Все</span> : null}
          {overdueOnly ? <FilterTag label="Просроченные" onRemove={clearList} /> : null}
          {filters.filter ? (
            <FilterTag
              label={FILTER_LABELS[filters.filter]}
              onRemove={() => {
                setFilters((current) => ({ ...current, filter: undefined }));
                clearList();
              }}
            />
          ) : null}
          {selectedStatus ? (
            <FilterTag
              label={STATUS_LABELS[selectedStatus] ?? 'Статус'}
              onRemove={() => {
                clearList();
                setFilters((current) => ({ ...current, status: undefined }));
              }}
            />
          ) : null}
          {filters.objectId ? (
            <FilterTag
              label="Объект"
              onRemove={() => setFilters((current) => ({ ...current, objectId: undefined }))}
            />
          ) : null}
        </div>
      </div>
      {objectOpen ? (
        <Sheet
          open
          title="Фильтры дел"
          description="Выберите условия: список меняется сразу"
          onOpenChange={setObjectOpen}
        >
          <fieldset className="studio-filters" aria-label="Фильтр дел">
            {(Object.entries(FILTER_LABELS) as [keyof typeof FILTER_LABELS, string][]).map(
              ([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="studio-filter"
                  aria-pressed={filters.filter === value}
                  onClick={() => {
                    setFilters((current) => ({
                      ...current,
                      filter: current.filter === value ? undefined : value,
                    }));
                    clearList();
                  }}
                >
                  {label}
                </button>
              ),
            )}
          </fieldset>
          <SelectField
            label="Статус дел"
            value={selectedStatus ?? ''}
            onChange={(value) => {
              clearList();
              setFilters((current) => ({
                ...current,
                status: value ? (value as TaskFilters['status']) : undefined,
              }));
            }}
            options={[
              { value: '', label: 'Все статусы' },
              ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
            ]}
          />
          <RecordPicker
            kind="object"
            label="Фильтр по объекту"
            value={filters.objectId ?? ''}
            onChange={(value) =>
              setFilters((current) => ({ ...current, objectId: value || undefined }))
            }
          />
          <button className="btn btn--primary" type="button" onClick={() => setObjectOpen(false)}>
            Готово
          </button>
        </Sheet>
      ) : null}{' '}
      <QueryNotice query={query} />
      {!moving ? <OperationNotice operation={operation} /> : null}
      <ContentMotion version={selected.map((card) => card.id + card.status).join(',')}>
        {query.data && !selected.length ? (
          <p className="muted">Дел под выбранные условия нет.</p>
        ) : null}
        <MotionGroups version={selected.map((card) => card.id + card.status).join(',')}>
          {today
            ? groups.map((group) =>
                group.tasks.length ? (
                  <Section
                    key={group.title}
                    motionKey={group.title}
                    title={group.title}
                    aside={<span className="muted">{group.tasks.length}</span>}
                  >
                    {rows(group.tasks, group.title)}
                  </Section>
                ) : null,
              )
            : rows(selected, 'Все дела')}
        </MotionGroups>
      </ContentMotion>
      <LoadMore query={query} label="Показать ещё дела" />
      {moving && timeZone ? (
        <MoveTaskSheet
          key={moving.id}
          card={moving}
          timeZone={timeZone}
          pending={operation.pending}
          error={operation.error}
          close={actions.close}
          move={actions.move}
        />
      ) : null}
    </TasksPage>
  );
}
const FILTER_LABELS = {
  mine: 'Моё',
  assigned: 'Другим',
  waiting: 'Жду',
  undated: 'Без даты',
} as const;

export function QueryNotice({
  query,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown };
}) {
  return (
    <>
      {query.isPending ? <ListSkeleton label="Загружаем дела…" /> : null}
      {query.error ? (
        <Notice error>
          {taskError(query.error)}{' '}
          <button type="button" className="text-button" onClick={() => void query.refetch()}>
            Повторить загрузку дел
          </button>
        </Notice>
      ) : null}
    </>
  );
}
export function LoadMore({
  query,
  label,
  onFocus,
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  label: string;
  onFocus?: () => void;
}) {
  return query.hasNextPage ? (
    <button
      type="button"
      className="btn btn--secondary btn--block list-action"
      disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
      onFocus={onFocus}
    >
      {query.isFetchingNextPage ? 'Загружаем…' : label}
    </button>
  ) : null;
}
