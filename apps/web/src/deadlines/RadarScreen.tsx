import { CalendarBlank, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { SCOPE_LABELS } from '../access/scope.ts';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { ChipGroup } from '../ui/ChipGroup.tsx';
import { EMPTY_SCOPE_EXPLANATION, EmptyState } from '../ui/EmptyState.tsx';
import { countWord } from '../ui/format.ts';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';
import { DeadlineError } from './components.tsx';
import {
  filterRows,
  GROUP_LABELS,
  GROUP_ORDER,
  groupRows,
  type RadarRow,
  type RadarView,
  VIEW_LABELS,
} from './radar.ts';
import { useRadar } from './useRadar.ts';

const BACK = { to: '/more', label: 'Ещё' } as const;
const VIEW_OPTIONS = (Object.keys(VIEW_LABELS) as RadarView[]).map((value) => ({
  value,
  label: VIEW_LABELS[value],
}));

/** Сколько пунктов по-русски: «1 пункт», «2 пункта», «5 пунктов». */
export const pointCount = (count: number) => countWord(count, ['пункт', 'пункта', 'пунктов']);

/** Пункт радара: название записи, что за срок, когда, значок пространства, переход в карточку. */
export function RadarRows({ rows, label }: { rows: readonly RadarRow[]; label: string }) {
  return (
    <RowList label={label}>
      {rows.map((row) => (
        <Row
          key={row.id}
          {...(row.to === null ? {} : { to: row.to })}
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
            </>
          }
          badge={row.visibility}
        />
      ))}
    </RowList>
  );
}

/** Радар (DEAD-3): группы по времени дома, «Моё · Весь дом» и общий переключатель «Всё · Общее · Личное». */
export function RadarScreen() {
  const { me } = useHousehold();
  const { scope, setScope } = useScope();
  const radar = useRadar();
  const [view, setView] = useState<RadarView>('mine');

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

      {radar.rows.length === 0 ? (
        <EmptyState icon={<CalendarBlank size={24} aria-hidden />} title="Сроков пока нет">
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
        Даты и время — по часовому поясу дома. Закрывать пункты радара в приложении пока нельзя:
        откройте карточку записи.
      </p>
      <Link className="text-button" to="/more/house">
        Часовой пояс дома
      </Link>
    </Page>
  );
}
