import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { RadarRows } from '../deadlines/RadarScreen.tsx';
import { ReadingsWindowsFromRows } from '../deadlines/ReadingsWindowCards.tsx';
import { buildRows, filterRows } from '../deadlines/radar.ts';
import { isOpenWindow } from '../deadlines/utility.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { PushCard } from '../notifications/PushCard.tsx';
import { AddAction } from '../shell/AddAction.tsx';
import { FirstRunCard } from '../templates/FirstRunCard.tsx';
import { EMPTY_SCOPE_EXPLANATION } from '../ui/EmptyState.tsx';
import { LinkTabs } from '../ui/LinkTabs.tsx';
import { Page, Section } from '../ui/Page.tsx';
import type { TaskFilters } from './api.ts';
import { taskError } from './errors.ts';
import { SelectField } from './fields.tsx';
import { RecordPicker } from './options.tsx';
import { PlanFeed } from './PlanFeed.tsx';
import { uniqueTasks, useTaskList, useToday } from './queries.ts';
import { STATUS_LABELS } from './TaskForm.tsx';
import { TaskRows } from './TaskRows.tsx';
import { TodayHero } from './TodayHero.tsx';
import './today.css';

const tabs = [
  { to: '/today', label: 'Сегодня', end: true },
  { to: '/today/plan', label: 'План' },
  { to: '/today/all', label: 'Все дела' },
];
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
    <TasksPage view={view} house={house}>
      <AllFeed key={house} house={house} />
    </TasksPage>
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
  const tabsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const header = document.querySelector('.topbar');
    if (!header) return;
    const measure = () =>
      tabsRef.current?.style.setProperty(
        '--task-header-height',
        `${header.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const feedTabs = (
    <div className="today-tabs" ref={tabsRef}>
      <LinkTabs
        label="Ленты дел"
        items={tabs.map((tab) => ({ ...tab, to: `${tab.to}${houseQuery}` }))}
      />
      <AddAction />
    </div>
  );
  const actions = (
    <div className="task-actions">
      <Link className="btn btn--secondary" to={`/today/new${houseQuery}`}>
        Новое дело
      </Link>
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
      {view === 'today' ? feedTabs : null}
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
      {view === 'all' ? actions : null}
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
      className={view === 'today' ? 'today-page' : view === 'plan' ? 'plan-page' : undefined}
      tabs={view === 'today' ? undefined : feedTabs}
    >
      {view === 'today' ? (
        <div className="studio-panel today-panel" id="today-panel">
          {content}
        </div>
      ) : (
        content
      )}
    </Page>
  );
}
function TodayFeed({ house }: { house: string | null }) {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const query = useToday(house);
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
    (row) => !isOpenWindow(row),
  );
  const houseQuery = house && house !== householdId ? `?householdId=${house}` : '';
  return (
    <TasksPage
      view="today"
      house={house}
      hero={<TodayHero data={query.data} error={query.error} house={house} />}
    >
      <QueryNotice query={query} />
      {query.data ? (
        <Section title="Главное на сегодня" eyebrow>
          {query.data.main ? (
            <TaskRows
              label="Главное дело"
              tasks={[query.data.main]}
              radar={query.error || query.data.recalculating ? [] : query.data.radar}
              focus
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
      {query.data ? (
        <>
          <ReadingsWindowsFromRows rows={rows} />
          {query.data.recalculating ? (
            <Notice>
              Сроки пересчитываются.{' '}
              <button className="text-button" type="button" onClick={() => void query.refetch()}>
                Обновить сегодня
              </button>
            </Notice>
          ) : null}
          <Section title="Сегодня и просроченные">
            <TaskRows
              label="Дела на сегодня"
              tasks={query.data.tasks.filter((task) => task.id !== query.data.main?.id)}
            />
          </Section>
          <details className="task-completed">
            <summary>Выполнено сегодня ({query.data.completed.length})</summary>
            <TaskRows label="Выполненные дела" tasks={query.data.completed} />
          </details>
          <Section title="Срочное из радара">
            {urgent.length === 0 ? <p className="muted">Срочного нет.</p> : null}
            <RadarRows rows={urgent.slice(0, 5)} label="Срочные сроки" />
            <Link className="text-button" to="/more/radar">
              Весь радар
            </Link>
          </Section>
        </>
      ) : null}
      <PushCard />
    </TasksPage>
  );
}
function AllFeed({ house }: { house: string | null }) {
  const [filters, setFilters] = useState<TaskFilters>({});
  const query = useTaskList(filters, false, house);
  return (
    <>
      <div className="task-filters">
        <SelectField
          label="Фильтр дел"
          value={filters.filter ?? ''}
          onChange={(value) =>
            setFilters((current) => ({
              ...current,
              filter: value ? (value as TaskFilters['filter']) : undefined,
            }))
          }
          options={[
            { value: '', label: 'Все' },
            { value: 'mine', label: 'Моё' },
            { value: 'assigned', label: 'Назначил другим' },
            { value: 'undated', label: 'Без даты' },
            { value: 'waiting', label: 'Жду' },
          ]}
        />
        <SelectField
          label="Статус дел"
          value={filters.status ?? ''}
          onChange={(value) =>
            setFilters((current) => ({
              ...current,
              status: value ? (value as TaskFilters['status']) : undefined,
            }))
          }
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
      </div>
      <QueryNotice query={query} />
      <TaskRows
        label="Все дела"
        tasks={uniqueTasks(query.data?.pages.flat() ?? []).filter(
          (task) => !house || !task.householdId || task.householdId === house,
        )}
      />
      <LoadMore query={query} label="Показать ещё дела" />
    </>
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
}: {
  query: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  label: string;
}) {
  return query.hasNextPage ? (
    <button
      type="button"
      className="btn btn--secondary btn--block list-action"
      disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
    >
      {query.isFetchingNextPage ? 'Загружаем…' : label}
    </button>
  ) : null;
}
