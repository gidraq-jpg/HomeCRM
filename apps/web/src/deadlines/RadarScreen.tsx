import type { RadarFilters } from '@homecrm/shared';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { radarFromToday } from '../shell/BottomNav.tsx';
import { countWord } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import { DeadlineError, RecalculatingNotice } from './components.tsx';
import { RadarRows } from './RadarRows.tsx';
import {
  filterRows,
  GROUP_LABELS,
  GROUP_ORDER,
  groupRows,
  type RadarView,
  VIEW_LABELS,
} from './radar.ts';

export { RadarRows } from './RadarRows.tsx';

import { useRadar } from './useRadar.ts';
import '../styles/studio2-lists.css';

const BACK = { to: '/more', label: 'Ещё' } as const;
const VIEW_OPTIONS = (Object.keys(VIEW_LABELS) as RadarView[]).map((value) => ({
  value,
  label: VIEW_LABELS[value],
}));

/** Сколько пунктов по-русски: «1 пункт», «2 пункта», «5 пунктов». */
export const pointCount = (count: number) => countWord(count, ['пункт', 'пункта', 'пунктов']);

export function RadarScreen() {
  const { me } = useHousehold();
  const { scope, setScope } = useScope();
  const [params] = useSearchParams();
  const location = useLocation();
  const back = radarFromToday(location.search, location.state)
    ? {
        to: `/today${me.roles.some((role) => role.householdId === params.get('householdId')) ? `?householdId=${params.get('householdId')}` : ''}`,
        label: 'Сегодня',
      }
    : BACK;
  const [view, setView] = useState<RadarView>(() =>
    params.get('view') === 'house' ? 'house' : 'mine',
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [filters, setFilters] = useState<Partial<RadarFilters>>(() => {
    const householdId = params.get('householdId');
    return householdId && me.roles.some((role) => role.householdId === householdId)
      ? { householdId }
      : {};
  });
  const radar = useRadar({
    filters: {
      ...filters,
      scope: scope === 'shared' ? 'household' : scope,
      view: view === 'mine' ? 'mine' : 'all',
    },
  });

  if (radar.status === 'loading') {
    return (
      <Page title="Радар" back={back}>
        <Notice>Загружаем радар…</Notice>
      </Page>
    );
  }
  if (radar.status === 'error') {
    return (
      <Page title="Радар" back={back}>
        <DeadlineError error={radar.error} action="load" />
        <button className="text-button" type="button" onClick={radar.refetch}>
          Повторить загрузку радара
        </button>
      </Page>
    );
  }

  const options = { scope, meId: me.id };
  const shown = filterRows(radar.rows, { ...options, view });
  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== undefined && (key !== 'state' || value !== 'active'),
  );
  const groups = groupRows(shown);

  return (
    <Page
      title="Радар"
      back={back}
      className="studio-list-page radar-page"
      heading={
        <div className="studio-list-hero">
          <h1>Радар</h1>
          <fieldset className="studio-segments" aria-label="Чьи сроки показывать">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => setView(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <div className="studio-filters">
            <button className="studio-filter" type="button" onClick={() => setFilterOpen(true)}>
              Объект ▾
            </button>
            <button className="studio-filter" type="button" onClick={() => setFilterOpen(true)}>
              Человек ▾
            </button>
            <button className="studio-filter" type="button" onClick={() => setFilterOpen(true)}>
              Ещё фильтры
            </button>
          </div>
        </div>
      }
    >
      <div className="studio-panel studio-list-panel">
        {filterOpen ? (
          <Sheet
            open
            title="Фильтры радара"
            description="Объект, человек, дом и состояние срока"
            onOpenChange={setFilterOpen}
          >
            <div className="field">
              {me.roles.length > 1 ? (
                <label className="field">
                  Дом
                  <select
                    className="input"
                    value={filters.householdId ?? ''}
                    onChange={(e) => setFilters({ householdId: e.target.value || undefined })}
                  >
                    <option value="">Все мои дома</option>
                    {radar.options.houses.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.title} · {h.role}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field">
                Объект
                <select
                  className="input"
                  value={filters.objectId ?? ''}
                  onChange={(e) =>
                    setFilters({ ...filters, objectId: e.target.value || undefined })
                  }
                >
                  <option value="">Все объекты</option>
                  {radar.options.objects.map((o) => (
                    <option key={`${o.id}:${o.role}`} value={o.id}>
                      {o.title} · {o.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Человек
                <select
                  className="input"
                  value={filters.personId ?? ''}
                  onChange={(e) =>
                    setFilters({ ...filters, personId: e.target.value || undefined })
                  }
                >
                  <option value="">Все люди</option>
                  {radar.options.people.map((p) => (
                    <option key={`${p.id}:${p.role}`} value={p.id}>
                      {p.title} · {p.role}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Состояние
                <select
                  className="input"
                  value={filters.state ?? 'active'}
                  onChange={(e) =>
                    setFilters({ ...filters, state: e.target.value as RadarFilters['state'] })
                  }
                >
                  <option value="active">В радаре</option>
                  <option value="snoozed">Отложенные</option>
                  <option value="dismissed">Не актуальные</option>
                  <option value="all">Все состояния</option>
                </select>
              </label>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setFilters({});
                  setScope('all');
                  setView('mine');
                }}
              >
                Сбросить фильтры
              </button>
            </div>
            <button className="btn btn--primary" type="button" onClick={() => setFilterOpen(false)}>
              Готово
            </button>
          </Sheet>
        ) : null}
        {radar.error ? (
          <Notice error>Не удалось обновить радар. Показаны последние загруженные сроки.</Notice>
        ) : null}
        {radar.recalculating ? (
          <RecalculatingNotice stalled={radar.stalled} onRetry={radar.retry} />
        ) : null}

        {radar.rows.length === 0 && radar.recalculating ? null : shown.length === 0 ? (
          <p className="muted">
            {hasFilters
              ? 'Под выбранные фильтры сроков нет'
              : radar.visibleCount === 0
                ? 'Сроков пока нет'
                : view === 'mine'
                  ? 'У вас сроков нет'
                  : 'Под выбранный режим сроков нет'}
          </p>
        ) : (
          GROUP_ORDER.map((group) =>
            groups[group].length === 0 ? null : group === '30days' || group === '90days' ? (
              <details className="studio-radar-fold" key={group}>
                <summary>
                  {GROUP_LABELS[group]} · {groups[group].length} ·{' '}
                  {groups[group]
                    .slice(0, 2)
                    .map((row) => row.title ?? row.what)
                    .join(', ')}
                </summary>
                <RadarRows rows={groups[group]} label={GROUP_LABELS[group]} />
              </details>
            ) : (
              <Section
                key={group}
                title={GROUP_LABELS[group]}
                aside={<span className="muted">{groups[group].length}</span>}
              >
                <div className={group === 'overdue' ? 'studio-radar-overdue' : undefined}>
                  <RadarRows rows={groups[group]} label={GROUP_LABELS[group]} />
                </div>
              </Section>
            ),
          )
        )}

        {radar.unresolved > 0 ? (
          <p className="muted">
            У {pointCount(radar.unresolved)} не нашлась запись: перейти в карточку нельзя.
          </p>
        ) : null}
        <p className="muted radar-note">
          Даты и время — по часовому поясу дома. Оплату, поверку и передачу окна без счётчиков можно
          отметить прямо здесь; остальные сроки закрываются в карточке записи.
        </p>
        <Link className="text-button" to="/more/house">
          Часовой пояс дома
        </Link>
      </div>
    </Page>
  );
}
