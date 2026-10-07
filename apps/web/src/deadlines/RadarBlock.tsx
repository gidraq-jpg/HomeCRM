import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useScope } from '../access/ScopeContext.tsx';
import { Notice } from '../auth/components.tsx';
import { useHousehold } from '../household/HouseholdContext.tsx';
import { Section } from '../ui/Page.tsx';
import { DeadlineError } from './components.tsx';
import { pointCount, RadarRows } from './RadarScreen.tsx';
import { filterRows } from './radar.ts';
import { useRadar } from './useRadar.ts';

/** Сколько срочных пунктов показывает «Сегодня»; остальные — в полном радаре. */
const LIMIT = 5;

/** «Сегодня»: срочное из радара — просроченное и то, что открыто сейчас; только то, за что отвечает участник. */
export function RadarBlock() {
  const { me } = useHousehold();
  const { scope } = useScope();
  const radar = useRadar();

  let body: ReactNode;
  if (radar.status === 'loading') {
    body = <Notice>Загружаем срочное…</Notice>;
  } else if (radar.status === 'error') {
    body = (
      <>
        <DeadlineError error={radar.error} action="load" />
        <button className="text-button" type="button" onClick={radar.refetch}>
          Повторить загрузку срочного
        </button>
      </>
    );
  } else {
    const urgent = filterRows(radar.rows, { view: 'mine', scope, meId: me.id }).filter(
      (row) => row.group === 'overdue' || row.group === 'now',
    );
    // Просроченное идёт первым: `groupRows` не нужен, достаточно порядка по группе и времени.
    urgent.sort(
      (a, b) =>
        Number(b.group === 'overdue') - Number(a.group === 'overdue') || a.startsAt - b.startsAt,
    );
    body =
      urgent.length === 0 ? (
        <p className="muted">
          Срочного нет: просроченных сроков и открытых окон за вами сейчас нет.
        </p>
      ) : (
        <>
          <RadarRows rows={urgent.slice(0, LIMIT)} label="Срочные сроки" />
          {urgent.length > LIMIT ? (
            <p className="muted">Ещё {pointCount(urgent.length - LIMIT)} — в радаре.</p>
          ) : null}
        </>
      );
  }

  return (
    <Section
      title="Срочное из радара"
      aside={
        <Link className="text-button" to="/more/radar">
          Весь радар
        </Link>
      }
    >
      {body}
    </Section>
  );
}
