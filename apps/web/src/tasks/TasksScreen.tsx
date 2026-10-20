import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { RadarRows } from '../deadlines/RadarScreen.tsx';
import { ReadingsWindowsFromRows } from '../deadlines/ReadingsWindowCards.tsx';
import { buildRows, filterRows } from '../deadlines/radar.ts';
import { isOpenWindow } from '../deadlines/utility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { PushCard } from '../notifications/PushCard.tsx';
import { useSettings } from '../notifications/queries.ts';
import { todayIn } from '../objects/dates.ts';
import { useQueue } from '../offline/OfflinePanel.tsx';
import { FirstRunCard } from '../templates/FirstRunCard.tsx';
import { EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { FeedTaskCard, type TaskCard, type TaskFilters, type Today } from './api.ts';
import { taskError } from './errors.ts';
import { SelectField } from './fields.tsx';
import { MoveTaskSheet } from './MoveTaskSheet.tsx';
import { OperationNotice } from './operation.tsx';
import { RecordPicker } from './options.tsx';
import { PlanFeed } from './PlanFeed.tsx';
import { PlanRows } from './PlanRows.tsx';
import { uniqueTasks, useTaskList, useToday } from './queries.ts';
import { queuedStatus } from './queued-status.ts';
import { STATUS_LABELS } from './TaskForm.tsx';
import { TaskRows } from './TaskRows.tsx';
import { TaskTabs } from './TaskTabs.tsx';
import { TodayHero } from './TodayHero.tsx';
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
  const { scope } = useScope();
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
      {view !== 'plan' ? feedTabs : null}
      {scope !== 'all' ? <p className="muted">{EMPTY_SCOPE_EXPLANATION[scope]}</p> : null}
      {me.roles.length > 1 ? (
        <SelectField
          label="Выбранный дом"
          value={house ?? ''}
          onChange={(value) => setParams({ householdId: value })}
          options={me.roles.map((role, index) => ({
            value: role.householdId,
            label: `Дом ${index + 1}`,
          }))}
        />
      ) : null}
      {children}
      {view === 'today' ? actions : null}
    </>
  );
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
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const client = useQueryClient();
  const query = useToday(house);
  const settings = useSettings();
  const loadingFeed = query.isPending || settings.isPending;
  const showMain = settings.data?.todayMainEnabled === true;
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
        <div className="today-feed-skeleton" role="status">
          <span className="visually-hidden">Загружаем дела…</span>
        </div>
      ) : (
        <QueryNotice query={query} />
      )}
      {settings.error ? (
        <Notice error>
          Не удалось загрузить настройку главного дела.{' '}
          <button type="button" className="text-button" onClick={() => void settings.refetch()}>
            Повторить загрузку настройки
          </button>
        </Notice>
      ) : null}
      {!loadingFeed && query.data && showMain ? (
        <Section title="Главное на сегодня" eyebrow>
          {query.data.main ? (
            <TaskRows
              label="Главное дело"
              tasks={[query.data.main]}
              radar={query.error || query.data.recalculating ? [] : query.data.radar}
              focus
              move={actions.startMove}
              pending={operation.pending}
            />
          ) : (
            <div className="focus task-focus">
              <h3 className="focus__title">Что сегодня важнее всего?</h3>
              <p className="focus__meta">
                Одно дело, которому вы хотите уделить внимание. Выберите его в карточке дела.
              </p>
              <div className="focus__actions">
                <Link
                  className="btn btn--primary"
                  to={
                    query.data.tasks.length ? `/today/all${houseQuery}` : `/today/new${houseQuery}`
                  }
                >
                  {query.data.tasks.length ? 'Выбрать главное дело' : 'Добавить дело'}
                </Link>
              </div>
            </div>
          )}
        </Section>
      ) : null}
      <FirstRunCard />
      {!moving ? <OperationNotice operation={operation} /> : null}
      {!loadingFeed && query.data ? (
        <>
          <ReadingsWindowsFromRows rows={rows} />
          <Section title="Сегодня и просроченные">
            <TaskRows
              label="Дела на сегодня"
              tasks={query.data.tasks.filter(
                (task) => !showMain || task.id !== query.data.main?.id,
              )}
              move={actions.startMove}
              pending={operation.pending}
            />
          </Section>
          {query.data.completed.length ? (
            <details className="task-completed">
              <summary>Выполнено сегодня ({query.data.completed.length})</summary>
              <TaskRows label="Выполненные дела" tasks={query.data.completed} />
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
      return next;
    });
  const query = useTaskList(filters, false, house);
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
  const active = tasks.filter((task) => ['open', 'waiting'].includes(task.status));
  const overdue = active.filter((task) => task.planOn && today && task.planOn < today);
  const selected = overdueOnly
    ? tasks.filter(
        (task) =>
          task.planOn && today && task.planOn < today && ['open', 'waiting'].includes(task.status),
      )
    : openOnly
      ? active
      : tasks.filter(
          (task) =>
            filters.status ||
            ['open', 'waiting'].includes(task.status) ||
            (timeZone && todayIn(timeZone, new Date(task.updatedAt)) >= today),
        );
  const groups = [
    { title: 'Просрочено', tasks: selected.filter((task) => task.planOn && task.planOn < today) },
    {
      title: 'Эта неделя',
      tasks: selected.filter((task) => task.planOn && task.planOn >= today && task.planOn <= end),
    },
    { title: 'Позже', tasks: selected.filter((task) => task.planOn && task.planOn > end) },
    { title: 'Без даты', tasks: selected.filter((task) => !task.planOn) },
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
  const unfiltered = !filters.filter && !filters.status && !filters.objectId;
  const summary = query.data && !query.error && !query.hasNextPage && unfiltered;
  const rows = (items: typeof tasks, title: string) => (
    <PlanRows
      tasks={items}
      label={title}
      today={today}
      pending={operation.pending}
      dates
      complete={actions.complete}
      resume={actions.resume}
      resumeBlocked={actions.resumeBlocked}
      move={timeZone ? actions.startMove : undefined}
    />
  );
  return (
    <TasksPage
      view="all"
      house={house}
      hero={
        <div className="studio-list-hero">
          <h1>Все дела</h1>
          {summary ? (
            <p className="studio-list-summary">
              У вас{' '}
              <Link
                className="text-button"
                to={listHref('open')}
                onClick={() => {
                  setFilters({});
                }}
              >
                {countWord(active.length, ['открытое дело', 'открытых дела', 'открытых дел'])}
              </Link>
              {overdue.length ? (
                <>
                  , из них{' '}
                  <Link
                    className="text-button"
                    to={listHref('overdue')}
                    onClick={() => {
                      setFilters({});
                    }}
                  >
                    {overdue.length} просрочено
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      }
    >
      <fieldset className="studio-filters" aria-label="Фильтр дел">
        {(
          [
            { value: 'mine', label: 'Моё' },
            { value: 'assigned', label: 'Другим' },
            { value: 'waiting', label: 'Жду' },
            { value: 'undated', label: 'Без даты' },
          ] as const
        ).map((item) => (
          <button
            key={item.value}
            type="button"
            className="studio-filter"
            aria-pressed={filters.filter === item.value}
            onClick={() => {
              setFilters((current) => ({
                ...current,
                filter: current.filter === item.value ? undefined : item.value,
              }));
              clearList();
            }}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className="studio-filter"
          aria-pressed={!!filters.objectId}
          onClick={() => setObjectOpen(true)}
        >
          Объект ▾
        </button>
      </fieldset>
      <details className="studio-list-options">
        <summary>Статус дел</summary>
        <SelectField
          label="Статус дел"
          value={filters.status ?? ''}
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
      </details>
      {objectOpen ? (
        <Sheet
          open
          title="Фильтр по объекту"
          description="Выберите объект для списка дел"
          onOpenChange={setObjectOpen}
        >
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
      ) : null}
      <QueryNotice query={query} />
      {!moving ? <OperationNotice operation={operation} /> : null}
      {query.data && !selected.length ? (
        <p className="muted">Дел под выбранные условия нет.</p>
      ) : null}
      {today
        ? groups.map((group) =>
            group.tasks.length ? (
              <Section
                key={group.title}
                title={group.title}
                aside={
                  <span className="muted">
                    {group.tasks.filter((task) => ['open', 'waiting'].includes(task.status)).length}
                  </span>
                }
              >
                {rows(group.tasks, group.title)}
              </Section>
            ) : null,
          )
        : rows(selected, 'Все дела')}
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
export function QueryNotice({
  query,
}: {
  query: { isPending: boolean; error: unknown; refetch: () => unknown };
}) {
  return (
    <>
      {query.isPending ? <Notice>Загружаем дела…</Notice> : null}
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
