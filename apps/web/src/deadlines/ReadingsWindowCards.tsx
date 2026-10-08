import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { useMeters } from '../meters/queries.ts';
import { todayIn } from '../objects/dates.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { Section } from '../ui/Page.tsx';
import { filterRows } from './radar.ts';
import { MarkReadingsButton, readingsPath } from './UtilityActions.tsx';
import { useRadar } from './useRadar.ts';
import {
  progressText,
  untilText,
  type WindowCard as WindowCardData,
  windowCards,
  windowProgress,
} from './utility.ts';

// Карточка «Открыто окно показаний» на «Сегодня» (UTIL-7). Название объекта крупно и первым,
// статус («Живём», «Сдаётся») рядом: на прототипе посторонний человек ошибся квартирой.

function WindowCard({ card }: { card: WindowCardData }) {
  const { me } = useHousehold();
  const today = todayIn(me.timeZone);
  const meters = useMeters(card.objectId, 'active');
  const ready = card.windows.filter((row) => !row.utility.needsMeters);
  const empty = card.windows.filter((row) => row.utility.needsMeters);
  const end = card.windows
    .map((row) => row.utility.endDate)
    .reduce((first, date) => (date < first ? date : first));

  // Сколько счётчиков ещё без показаний — только пока загружен список счётчиков объекта.
  let note: string | null = null;
  if (meters.data) {
    let missing = 0;
    let untransmitted = 0;
    for (const row of ready) {
      const progress = windowProgress(meters.data, row.utility);
      missing += progress.missing;
      untransmitted += progress.untransmitted;
    }
    note = progressText({ total: missing + untransmitted, missing, untransmitted });
  }

  return (
    <li className="card window-card">
      <div className="window-card__head">
        <h3 className="window-card__title">{card.title}</h3>
        {card.status ? <PropertyStatusBadge status={card.status} /> : null}
      </div>
      <p className="window-card__until">{untilText(end, today)}</p>
      {note ? <p className="window-card__note">{note}</p> : null}
      {ready.length > 0 ? (
        <Link className="btn btn--primary btn--block" to={readingsPath(card.objectId)}>
          Внести показания
        </Link>
      ) : null}
      {empty.map((row) => {
        const completion = row.utility.action?.completionAction;
        return (
          <div className="window-card__empty" key={row.id}>
            <p className="radar-hint">
              <Link to={`/home/${card.objectId}/meters`}>
                {row.utility.action?.hint ?? 'Добавьте счётчики'}
              </Link>
              <span className="muted"> · {row.utility.source}</span>
            </p>
            {completion ? (
              <MarkReadingsButton occurrenceId={completion.occurrenceId} label={completion.label} />
            ) : null}
          </div>
        );
      })}
    </li>
  );
}

/** Открытые окна показаний, по карточке на объект; нет открытых окон — блока нет. */
export function ReadingsWindowCards() {
  const { me } = useHousehold();
  const { scope } = useScope();
  const radar = useRadar({ poll: false });
  if (radar.status !== 'ready') return null;
  const cards = windowCards(filterRows(radar.rows, { view: 'house', scope, meId: me.id }));
  if (cards.length === 0) return null;
  return (
    <Section title="Открыто окно показаний">
      <ul className="card-list" aria-label="Открытые окна показаний">
        {cards.map((card) => (
          <WindowCard key={card.objectId} card={card} />
        ))}
      </ul>
    </Section>
  );
}
