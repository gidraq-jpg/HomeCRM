import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { useRadar } from '../deadlines/useRadar.ts';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMyProfile } from '../household/queries.ts';
import { listScopeOf } from '../notes/queries.ts';
import { todayIn } from '../objects/dates.ts';
import { useObjectsList } from '../objects/queries.ts';
import { formatLongDate, formatRub, formatShortDate, plural, weekdayName } from '../ui/format.ts';
import { useMonth } from '../utilities/queries.ts';

import type { Today } from './api.ts';
import { uniqueTasks } from './queries.ts';
import { metricValue, nearbyDeadlineCount, todayTaskCount } from './today.ts';

export function TodayHero({
  data,
  error,
  house,
}: {
  data: Today | undefined;
  error: unknown;
  house: string | null;
}) {
  const { me, householdId } = useHousehold();
  const { scope } = useScope();
  const profile = useMyProfile();
  const date = data
    ? todayIn(data.timeZone)
    : !house || house === householdId
      ? todayIn(me.timeZone)
      : undefined;
  const name = profile.data?.displayName.trim() || me.displayName;
  const radar = useRadar({
    filters: {
      scope: listScopeOf(scope),
      view: 'mine',
      ...(house ? { householdId: house } : {}),
    },
  });
  const objects = useObjectsList(false);
  const utilities = useMonth(undefined, house);
  const taskCount = data ? todayTaskCount(data.tasks) : undefined;
  const deadlineCount = radar.status === 'ready' ? nearbyDeadlineCount(radar.rows) : undefined;
  const objectCount = objects.data ? uniqueTasks(objects.data.pages.flat()).length : undefined;
  const tasksValue = metricValue(taskCount, error);
  const radarValue = metricValue(deadlineCount, radar.error, {
    recalculating: radar.recalculating,
  });
  const objectsValue = metricValue(objectCount, objects.error, { partial: objects.hasNextPage });
  const houseQuery = house && house !== householdId ? `?householdId=${house}` : '';
  const radarParams = new URLSearchParams({ view: 'mine' });
  if (house) radarParams.set('householdId', house);
  const metrics = [
    {
      key: 'tasks',
      to: `/today${houseQuery}`,
      ...tasksValue,
      label: `${plural(taskCount ?? 0, ['дело', 'дела', 'дел'])} сегодня`,
      description: 'Активные дела ленты «Сегодня», включая просроченные и главное дело.',
    },
    {
      key: 'radar',
      to: `/more/radar?${radarParams}`,
      ...radarValue,
      label: `близк${plural(deadlineCount ?? 0, ['ий срок', 'их срока', 'их сроков'])}`,
      description:
        'Мои активные сроки: просроченные, сейчас и в ближайшие 7 дней. Текущий дом и пространство.',
    },
    {
      key: 'objects',
      to: '/home',
      ...objectsValue,
      label: plural(objectCount ?? 0, ['объект', 'объекта', 'объектов']),
      description: `Доступные объекты текущего списка «Дом» в выбранном пространстве.${
        objects.hasNextPage && objectCount !== undefined
          ? ` Загружено не менее ${objectCount}; полный список — в «Доме».`
          : ''
      }`,
    },
  ];
  const phrases = [
    tasksValue.value === '—'
      ? '— дел'
      : taskCount === 0
        ? 'дел нет'
        : `${tasksValue.value} ${plural(taskCount ?? 0, ['дело', 'дела', 'дел'])}`,
    radarValue.value === '—'
      ? '— сроков'
      : deadlineCount === 0
        ? 'сроков на подходе нет'
        : `${radarValue.value} ${plural(deadlineCount ?? 0, ['срок', 'срока', 'сроков'])} на подходе`,
    objectsValue.value === '—'
      ? '— объектов'
      : objectCount === 0
        ? 'объектов под присмотром нет'
        : `${objectsValue.value} ${plural(objectCount ?? 0, ['объект', 'объекта', 'объектов'])} под присмотром`,
  ];
  // Только свежие видимые строки радара; неизвестные суммы и даты не подменяем нулём.
  const ready = radar.status === 'ready' && !radar.error && !radar.recalculating;
  const due = utilities.error ? 0 : (utilities.data?.totals.remainingCents ?? 0);
  const monthParams = new URLSearchParams();
  if (utilities.data) monthParams.set('month', utilities.data.month);
  if (house) monthParams.set('householdId', house);
  const windowEnd = ready
    ? radar.rows
        .filter((row) => row.utility?.kind === 'readings' && row.group === 'now')
        .map((row) => row.utility?.endDate)
        .sort()[0]
    : undefined;
  return (
    <div className="today-hero">
      <h1 className="visually-hidden">Сегодня</h1>
      <p className="page-heading__eyebrow today-hero__date">
        {date
          ? `${weekdayName(date)}, ${formatLongDate(date)}`
          : error
            ? 'Не удалось загрузить дату дома'
            : 'Загружаем дату дома…'}
      </p>
      <nav className="today-metrics" aria-label="Показатели на сегодня">
        <p className="today-hero__greeting">
          Добрый день, {name}. Сегодня{' '}
          {metrics.map((metric, index) => (
            <span key={metric.key}>
              <Link
                className="today-metric"
                to={metric.to}
                state={metric.key === 'radar' ? { fromSection: 'today' } : undefined}
                aria-label={`${metric.value} ${metric.label}${metric.status ? `: ${metric.status}` : ''}`}
                aria-describedby={`today-metric-${metric.key}`}
                onClick={
                  metric.key === 'tasks'
                    ? () =>
                        document.getElementById('today-panel')?.scrollIntoView({ block: 'start' })
                    : undefined
                }
              >
                <span aria-hidden>{phrases[index]}</span>
                <span id={`today-metric-${metric.key}`} className="visually-hidden">
                  {metric.description}
                </span>
              </Link>
              {index < 2 ? ', ' : '.'}
            </span>
          ))}
        </p>
      </nav>
      {due > 0 || windowEnd ? (
        <div className="today-hints">
          {due > 0 ? (
            <Link to={`/home/month?${monthParams}`}>{formatRub(due)} к оплате</Link>
          ) : null}
          {windowEnd ? <span>Показания до {formatShortDate(windowEnd)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
