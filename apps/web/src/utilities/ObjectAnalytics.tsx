import { ChartBar } from '@phosphor-icons/react';
import { Notice } from '../auth/components.tsx';
import { formatRub } from '../ui/format.ts';
import { Section } from '../ui/Page.tsx';
import {
  consumptionIn,
  hasData,
  maxOf,
  type ResourceKey,
  resourceId,
  resourcesOf,
  resourceTitle,
  showConsumption,
} from './analytics.ts';
import type { ObjectAnalytics as Analytics, AnalyticsMonth } from './api.ts';
import { BarChart, type BarSlot } from './BarChart.tsx';
import { monthShort } from './months.ts';
import { useAnalytics } from './queries.ts';

/** Подпись под столбцом: номер месяца; год — у первого месяца и у января. */
function slotLabel(month: AnalyticsMonth, index: number): Pick<BarSlot, 'key' | 'label' | 'year'> {
  const [year = '', number = ''] = month.month.split('-');
  return {
    key: month.month,
    label: String(Number(number)),
    ...(index === 0 || number === '01' ? { year } : {}),
  };
}

function Legend({
  items,
}: {
  items: readonly { mark: 'solid' | 'hatch' | 'dash'; text: string }[];
}) {
  return (
    <ul className="chart-legend" aria-label="Обозначения">
      {items.map((item) => (
        <li key={item.text}>
          <span
            className={`chart-legend__mark chart-legend__mark--${item.mark}`}
            aria-hidden="true"
          />
          {item.text}
        </li>
      ))}
    </ul>
  );
}

function MoneyBlock({ months }: { months: readonly AnalyticsMonth[] }) {
  const first = months[0];
  const last = months[months.length - 1];
  const slots: BarSlot[] = months.map((month, index) => ({
    ...slotLabel(month, index),
    bars: [month.chargedCents, month.paidCents],
    marker: month.previousYear?.chargedCents ?? null,
  }));
  const max = maxOf(slots.flatMap((slot) => [...slot.bars, slot.marker ?? 0]));
  return (
    <div className="analytics-block">
      <h3 className="analytics-block__title">Начислено и оплачено по месяцам</h3>
      <BarChart
        slots={slots}
        maxLabel={`Наибольшее значение: ${formatRub(max)}`}
        summary={`Начислено и оплачено по месяцам с ${first ? monthShort(first.month) : ''} по ${last ? monthShort(last.month) : ''}. Точные суммы — в таблице ниже.`}
      />
      <Legend
        items={[
          { mark: 'solid', text: 'Начислено' },
          { mark: 'hatch', text: 'Оплачено в месяце' },
          { mark: 'dash', text: 'Начислено год назад' },
        ]}
      />
    </div>
  );
}

function ConsumptionBlock({
  months,
  resource,
}: {
  months: readonly AnalyticsMonth[];
  resource: ResourceKey;
}) {
  const first = months[0];
  const last = months[months.length - 1];
  const title = resourceTitle(resource);
  // Высота столбца — только для рисунка; текст в таблице идёт из строки сервера.
  const slots: BarSlot[] = months.map((month, index) => {
    const now = consumptionIn(month.consumption, resource);
    const before = consumptionIn(month.previousYear?.consumption, resource);
    return {
      ...slotLabel(month, index),
      bars: [now === null ? 0 : Number(now)],
      marker: before === null ? null : Number(before),
    };
  });
  const max = maxOf(slots.flatMap((slot) => [...slot.bars, slot.marker ?? 0]));
  const maxText =
    months
      .flatMap((month) => [
        consumptionIn(month.consumption, resource),
        consumptionIn(month.previousYear?.consumption, resource),
      ])
      .filter((value): value is string => value !== null)
      .sort((a, b) => Number(b) - Number(a))[0] ?? null;
  return (
    <div className="analytics-block">
      <h3 className="analytics-block__title">Расход: {title}</h3>
      <BarChart
        slots={slots}
        maxLabel={
          max > 0
            ? `Наибольшее значение: ${showConsumption(maxText)} ${resource.unit}`.trim()
            : 'Расхода нет'
        }
        summary={`Расход, ${title}, по месяцам с ${first ? monthShort(first.month) : ''} по ${last ? monthShort(last.month) : ''}. Точные значения — в таблице ниже.`}
      />
      <Legend
        items={[
          { mark: 'solid', text: 'Расход в месяце' },
          { mark: 'dash', text: 'Тот же месяц год назад' },
        ]}
      />
    </div>
  );
}

function Tables({
  months,
  resources,
}: {
  months: readonly AnalyticsMonth[];
  resources: readonly ResourceKey[];
}) {
  const last = months[months.length - 1];
  return (
    <details className="analytics-tables">
      <summary>Таблицы с точными значениями</summary>

      <table className="data-table">
        <caption>Начислено и оплачено по месяцам</caption>
        <thead>
          <tr>
            <th scope="col">Месяц</th>
            <th scope="col">Начислено</th>
            <th scope="col">Оплачено</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.month}>
              <th scope="row">{monthShort(month.month)}</th>
              <td>{formatRub(month.chargedCents)}</td>
              <td>{formatRub(month.paidCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {last ? (
        <table className="data-table">
          <caption>
            Сравнение: {monthShort(last.month)} и тот же месяц годом раньше
            {last.previousYear ? ` (${monthShort(last.previousYear.month)})` : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">Показатель</th>
              <th scope="col">{monthShort(last.month)}</th>
              <th scope="col">
                {last.previousYear ? monthShort(last.previousYear.month) : 'Год назад'}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Начислено</th>
              <td>{formatRub(last.chargedCents)}</td>
              <td>{last.previousYear ? formatRub(last.previousYear.chargedCents) : '—'}</td>
            </tr>
            <tr>
              <th scope="row">Оплачено</th>
              <td>{formatRub(last.paidCents)}</td>
              <td>{last.previousYear ? formatRub(last.previousYear.paidCents) : '—'}</td>
            </tr>
            {resources.map((resource) => (
              <tr key={resourceId(resource)}>
                <th scope="row">{resourceTitle(resource)}</th>
                <td>{showConsumption(consumptionIn(last.consumption, resource))}</td>
                <td>{showConsumption(consumptionIn(last.previousYear?.consumption, resource))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {resources.map((resource) => (
        <table className="data-table" key={resourceId(resource)}>
          <caption>Расход по месяцам: {resourceTitle(resource)}</caption>
          <thead>
            <tr>
              <th scope="col">Месяц</th>
              <th scope="col">Расход</th>
              <th scope="col">Год назад</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{monthShort(month.month)}</th>
                <td>{showConsumption(consumptionIn(month.consumption, resource))}</td>
                <td>{showConsumption(consumptionIn(month.previousYear?.consumption, resource))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </details>
  );
}

function Charts({ data }: { data: Analytics }) {
  const months = data.months;
  if (months.length === 0 || !hasData(months)) {
    return (
      <p className="muted">
        За последние 12 месяцев начислений, оплат и показаний нет. Аналитика появится, когда по
        лицевым счетам будут начисления, а по счётчикам — показания.
      </p>
    );
  }
  const resources = resourcesOf(months);
  return (
    <>
      <MoneyBlock months={months} />
      {resources.map((resource) => (
        <ConsumptionBlock key={resourceId(resource)} months={months} resource={resource} />
      ))}
      <Tables months={months} resources={resources} />
    </>
  );
}

/**
 * «Аналитика» в карточке недвижимости (UTIL-12): суммы и расход по ресурсам за 12 месяцев и сравнение
 * с тем же месяцем прошлого года. Рисунок — SVG, а точные значения лежат в таблицах рядом.
 * У блока своя загрузка и ошибка: сбой не ломает остальную карточку.
 */
export function ObjectAnalytics({ objectId }: { objectId: string }) {
  const query = useAnalytics(objectId);
  return (
    <Section title="Аналитика" aside={<ChartBar size={22} aria-hidden />}>
      {query.isPending ? <Notice>Загружаем аналитику…</Notice> : null}
      {query.isError ? (
        <>
          <Notice error>Не удалось загрузить аналитику. Проверьте подключение и повторите.</Notice>
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку аналитики
          </button>
        </>
      ) : null}
      {query.data ? <Charts data={query.data} /> : null}
    </Section>
  );
}
