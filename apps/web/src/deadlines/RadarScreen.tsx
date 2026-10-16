import type { RadarFilters } from '@homecrm/shared';
import {
  CalendarBlank,
  DotsThreeVertical,
  Drop,
  FileText,
  Receipt,
  Warning,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { AccessBadge } from '../access/AccessBadge.tsx';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { PROPERTY_STATUS_LABELS } from '../property/property.ts';
import { radarFromToday } from '../shell/BottomNav.tsx';
import { TakeFromRadar } from '../tasks/TakeFromRadar.tsx';
import { countWord, formatRub } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { RowContent, RowList } from '../ui/Row.tsx';
import { Sheet } from '../ui/Sheet.tsx';
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
import '../styles/studio2-lists.css';

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

/** Полный радар: общие строки Studio; прежний RadarRows остаётся для «Сегодня». */
function StudioRadarRows({ rows, label }: { rows: readonly RadarRow[]; label: string }) {
  const [menu, setMenu] = useState<RadarRow | null>(null);
  return (
    <>
      <RowList label={label}>
        {rows.map((row) => {
          const item = row.item;
          const utility = row.utility;
          const hidden =
            item?.actionState?.status === 'dismissed' ||
            (item?.actionState?.status === 'snoozed' &&
              new Date(item.actionState.snoozedUntil ?? 0) > new Date());
          const main = hidden ? null : utility && utility.action?.kind !== 'verify_meter' ? (
            <UtilityActions utility={utility} withOpen={false} compact />
          ) : item?.primaryAction?.kind === 'renew_document' && item.documentId ? (
            <Link className="btn btn--secondary" to={`/documents/${item.documentId}?action=renew`}>
              Продлить
            </Link>
          ) : item?.taskId ? (
            <Link className="btn btn--secondary" to={`/today/tasks/${item.taskId}`}>
              В работу
            </Link>
          ) : item?.canWrite && item.sourceKind !== 'birthday' ? (
            <TakeFromRadar occurrenceId={row.id} assigneeId={row.assigneeId} label="В работу" />
          ) : null;
          const content = (
            <RowContent
              icon={
                item?.sourceKind === 'readings' || item?.sourceKind === 'verification' ? (
                  <Drop size={22} aria-hidden />
                ) : item?.sourceKind === 'payment' ? (
                  <Receipt size={22} aria-hidden />
                ) : item?.sourceKind === 'document' ? (
                  <FileText size={22} aria-hidden />
                ) : (
                  <CalendarBlank size={22} aria-hidden />
                )
              }
              iconTone={
                item?.sourceKind === 'readings' || item?.sourceKind === 'verification'
                  ? 'water'
                  : 'accent'
              }
              title={row.title ?? 'Запись не найдена'}
              meta={
                <>
                  {[
                    row.what,
                    row.when,
                    row.relative,
                    utility?.source,
                    utility?.status ? PROPERTY_STATUS_LABELS[utility.status] : null,
                    !utility && item?.object?.title !== row.title ? item?.object?.title : null,
                    utility?.remainingCents == null
                      ? null
                      : `осталось ${formatRub(utility.remainingCents)}`,
                    item?.actionState?.status === 'dismissed'
                      ? `Не актуально: ${item.actionState.reason}`
                      : item?.actionState?.status === 'snoozed'
                        ? 'Отложено до указанной даты'
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  <span className="studio-radar-access">
                    <AccessBadge visibility={row.visibility} />
                  </span>
                </>
              }
            />
          );
          return (
            <li
              key={row.id}
              className={
                row.group === 'overdue'
                  ? 'studio-radar-row studio-radar-row--overdue'
                  : 'studio-radar-row'
              }
            >
              {row.to ? (
                <Link className="row studio-radar-row__record" to={row.to}>
                  {content}
                </Link>
              ) : (
                <div className="row studio-radar-row__record">{content}</div>
              )}
              <div className="studio-radar-row__actions">
                {main}
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Ещё действия: ${row.title ?? 'срок'}`}
                  onClick={() => setMenu(row)}
                >
                  <DotsThreeVertical size={22} aria-hidden />
                </button>
              </div>
            </li>
          );
        })}
      </RowList>
      {menu ? (
        <Sheet
          open
          title={`Действия: ${menu.title ?? 'срок'}`}
          description="Отложить срок или отметить, что он не актуален"
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
        >
          {menu.utility?.action?.kind === 'verify_meter' ? (
            <UtilityActions utility={menu.utility} withOpen={false} />
          ) : null}
          <OccurrenceActions row={menu} menuOnly onSaved={() => setMenu(null)} />
          {menu.utility ? (
            <Link className="text-button" to={menu.utility.openTo} onClick={() => setMenu(null)}>
              {menu.utility.openLabel}
            </Link>
          ) : null}
          {menu.to ? (
            <Link className="text-button" to={menu.to} onClick={() => setMenu(null)}>
              Открыть запись
            </Link>
          ) : null}
          {menu.to && menu.item?.sourceKind !== 'record' ? (
            <Link
              className="text-button"
              to={menu.utility ? `/home/${menu.utility.objectId}` : menu.to}
              onClick={() => setMenu(null)}
            >
              Ответственный — в карточке источника
            </Link>
          ) : null}
        </Sheet>
      ) : null}
    </>
  );
}

/** Радар (DEAD-3): группы по времени дома, «Моё · Весь дом» и общий переключатель «Всё · Общее · Личное». */
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
                <StudioRadarRows rows={groups[group]} label={GROUP_LABELS[group]} />
              </details>
            ) : (
              <Section
                key={group}
                title={GROUP_LABELS[group]}
                aside={<span className="muted">{groups[group].length}</span>}
              >
                <div className={group === 'overdue' ? 'studio-radar-overdue' : undefined}>
                  <StudioRadarRows rows={groups[group]} label={GROUP_LABELS[group]} />
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
