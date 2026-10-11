import type { RadarFilters } from '@homecrm/shared';
import { CalendarBlank, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { TakeFromRadar } from '../tasks/TakeFromRadar.tsx';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { countWord, formatRub } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { RowContent, RowList } from '../ui/Row.tsx';
import { DeadlineError, RecalculatingNotice } from './components.tsx';
import { OccurrenceActions } from './OccurrenceActions.tsx';
import {
  filterRows,
  GROUP_LABELS,
  GROUP_ORDER,
  groupRows,
  type RadarRow,
  type RadarView,
  VIEW_LABELS,
} from './radar.ts';
import { UtilityActions } from './UtilityActions.tsx';
import { useRadar } from './useRadar.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;
const VIEW_OPTIONS = (Object.keys(VIEW_LABELS) as RadarView[]).map((value) => ({
  value,
  label: VIEW_LABELS[value],
}));

/** Сколько пунктов по-русски: «1 пункт», «2 пункта», «5 пунктов». */
export const pointCount = (count: number) => countWord(count, ['пункт', 'пункта', 'пунктов']);

/**
 * Коммунальный срок: объект с названием и статусом первым («Живём», «Сдаётся»), затем счёт или
 * счётчик, основное действие и «Открыть счёт» / «Открыть счётчик». Сам срок здесь не правится.
 */
function UtilityRadarItem({ row }: { row: RadarRow }) {
  const { utility } = row;
  if (utility === null) return null;
  return (
    <li className="radar-utility">
      <div className="row">
        <RowContent
          icon={
            row.group === 'overdue' ? (
              <Warning size={22} aria-hidden />
            ) : (
              <CalendarBlank size={22} aria-hidden />
            )
          }
          {...(row.group === 'overdue' ? { iconTone: 'warning' as const } : {})}
          title={
            <>
              {row.title ?? 'Объект'}
              {utility.status ? (
                <span className="row__status">
                  <PropertyStatusBadge status={utility.status} />
                </span>
              ) : null}
            </>
          }
          meta={
            <>
              <span className="radar-line">
                {row.what} · {utility.source}
                {utility.remainingCents == null
                  ? null
                  : ` · осталось ${formatRub(utility.remainingCents)}`}
              </span>
              <span className="radar-line">
                {row.when} · {row.relative}
              </span>
            </>
          }
          badge={row.visibility}
        />
      </div>
      {row.item?.sourceKind === 'readings' && !utility.needsMeters ? (
        <p className="muted">Без переданных показаний: {row.item.missingReadingsCount ?? 0}.</p>
      ) : null}
      <UtilityActions utility={utility} />
      <Link className="text-button" to={`/home/${utility.objectId}`}>
        Ответственный — в карточке источника
      </Link>
      {row.item?.canWrite ? (
        <TakeFromRadar occurrenceId={row.id} assigneeId={row.assigneeId} />
      ) : null}
      <OccurrenceActions row={row} />
    </li>
  );
}

/** Пункт радара: название записи, что за срок, когда, значок пространства, переход в карточку. */
function RecordRadarItem({ row }: { row: RadarRow }) {
  const content = (
    <RowContent
      icon={
        row.group === 'overdue' ? (
          <Warning size={22} aria-hidden />
        ) : (
          <CalendarBlank size={22} aria-hidden />
        )
      }
      {...(row.group === 'overdue' ? { iconTone: 'warning' as const } : {})}
      title={row.title ?? 'Запись не найдена'}
      meta={
        <>
          <span className="radar-line">{row.what}</span>
          <span className="radar-line">
            {row.when} · {row.relative}
          </span>
          {row.to && !row.to.startsWith('/home/') && !row.to.startsWith('/more/notes/') ? (
            <span className="radar-line">Ответственный — в карточке источника</span>
          ) : null}
        </>
      }
      badge={row.visibility}
    />
  );
  return (
    <li>
      {row.to ? (
        <Link className="row" to={row.to}>
          {content}
        </Link>
      ) : (
        <div className="row">{content}</div>
      )}
      {row.item?.canWrite && !row.item.taskId ? (
        <TakeFromRadar occurrenceId={row.id} assigneeId={row.assigneeId} />
      ) : null}
      <OccurrenceActions row={row} />
    </li>
  );
}
export function RadarRows({ rows, label }: { rows: readonly RadarRow[]; label: string }) {
  return (
    <RowList label={label}>
      {rows.map((row) =>
        row.utility ? (
          <UtilityRadarItem key={row.id} row={row} />
        ) : (
          <RecordRadarItem key={row.id} row={row} />
        ),
      )}
    </RowList>
  );
}

/** Радар (DEAD-3): группы по времени дома, «Моё · Весь дом» и общий переключатель «Всё · Общее · Личное». */
export function RadarScreen() {
  const { me } = useHousehold();
  const { scope, setScope } = useScope();
  const [view, setView] = useState<RadarView>('mine');
  const [filters, setFilters] = useState<Partial<RadarFilters>>({});
  const radar = useRadar({
    filters: {
      ...filters,
      scope: scope === 'shared' ? 'household' : scope,
      view: view === 'mine' ? 'mine' : 'all',
    },
  });

  if (radar.status === 'loading') {
    return (
      <Page title="Радар" back={BACK}>
        <Notice>Загружаем радар…</Notice>
      </Page>
    );
  }
  if (radar.status === 'error') {
    return (
      <Page title="Радар" back={BACK}>
        <DeadlineError error={radar.error} action="load" />
        <button className="text-button" type="button" onClick={radar.refetch}>
          Повторить загрузку радара
        </button>
      </Page>
    );
  }

  const options = { scope, meId: me.id };
  const shown = filterRows(radar.rows, { ...options, view });
  const house = filterRows(radar.rows, { ...options, view: 'house' });
  const groups = groupRows(shown);

  return (
    <Page
      title="Радар"
      back={BACK}
      {...(shown.length > 0 ? { eyebrow: pointCount(shown.length) } : {})}
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
            onChange={(e) => setFilters({ ...filters, objectId: e.target.value || undefined })}
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
            onChange={(e) => setFilters({ ...filters, personId: e.target.value || undefined })}
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
      <div className="field radar-view">
        <span className="field__label" aria-hidden="true">
          Чьи сроки показывать
        </span>
        <ChipGroup
          legend="Чьи сроки показывать"
          value={view}
          options={VIEW_OPTIONS}
          onChange={setView}
        />
      </div>
      {radar.error ? (
        <Notice error>Не удалось обновить радар. Показаны последние загруженные сроки.</Notice>
      ) : null}
      {radar.recalculating ? (
        <RecalculatingNotice stalled={radar.stalled} onRetry={radar.retry} />
      ) : null}

      {radar.rows.length === 0 && radar.recalculating ? null : radar.rows.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} aria-hidden />}
          title={
            Object.keys(filters).length ? 'Под выбранные фильтры сроков нет' : 'Сроков пока нет'
          }
        >
          <p>
            Срок добавляется в карточке объекта или заметки: откройте запись и нажмите «Добавить
            срок». В радар попадут даты, окна, повторы и сроки «через N после события» на 90 дней
            вперёд, а просроченное остаётся, пока его не закроют.
          </p>
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<CalendarBlank size={24} aria-hidden />}
          title={view === 'mine' ? 'У вас сроков нет' : 'Под выбранный режим сроков нет'}
          actions={
            <>
              {view === 'mine' && house.length > 0 ? (
                <button
                  type="button"
                  className="btn btn--primary btn--block"
                  onClick={() => setView('house')}
                >
                  Показать «{VIEW_LABELS.house}»
                </button>
              ) : null}
              {scope !== 'all' ? (
                <button
                  type="button"
                  className="btn btn--secondary btn--block"
                  onClick={() => setScope('all')}
                >
                  Показать «{SCOPE_LABELS.all}»
                </button>
              ) : null}
            </>
          }
        >
          <p>
            {view === 'mine'
              ? 'За вами сроков нет: «Моё» показывает только то, за что отвечаете вы.'
              : 'Среди видимых вам записей подходящих сроков нет.'}
          </p>
          {scope !== 'all' ? <p>{EMPTY_SCOPE_EXPLANATION[scope]}</p> : null}
        </EmptyState>
      ) : (
        GROUP_ORDER.map((group) =>
          groups[group].length === 0 ? null : (
            <Section
              key={group}
              title={GROUP_LABELS[group]}
              aside={<span className="muted">{groups[group].length}</span>}
            >
              <RadarRows rows={groups[group]} label={GROUP_LABELS[group]} />
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
    </Page>
  );
}
