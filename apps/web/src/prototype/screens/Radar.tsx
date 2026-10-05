import { Cake, FileText, Gauge, Receipt } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useScope } from '../../access/ScopeContext.tsx';
import { filterByScope } from '../../access/scope.ts';
import { Page, Section } from '../../ui/Page.tsx';
import { Row, RowList } from '../../ui/Row.tsx';
import { ScopeEmpty } from '../components.tsx';
import { TODAY } from '../data/index.ts';
import { buildRadar, RADAR_GROUPS, type RadarKind } from '../radar.ts';
import { usePrototype } from '../store.tsx';

const KIND_ICONS: Readonly<Record<RadarKind, React.ReactNode>> = {
  window: <Gauge size={22} aria-hidden />,
  payment: <Receipt size={22} aria-hidden />,
  document: <FileText size={22} aria-hidden />,
  birthday: <Cake size={22} aria-hidden />,
};

/** «Радар»: всё, что требует внимания, по горизонтам (DEAD-3). Здесь — без действий над пунктами. */
export function RadarScreen() {
  const { state, records } = usePrototype();
  const { scope } = useScope();
  const items = useMemo(
    () => filterByScope(buildRadar(records, state.readings, TODAY), scope),
    [records, state.readings, scope],
  );

  return (
    <Page title="Радар" back={{ to: '/more', label: 'Ещё' }} eyebrow="Что требует внимания">
      {items.length === 0 ? (
        <ScopeEmpty title="Пока ничего срочного" offerShowAll>
          Сроки показаний, оплаты, документов и дни рождения собираются здесь по горизонтам: от
          просроченного до ближайших 90 дней.
        </ScopeEmpty>
      ) : (
        RADAR_GROUPS.map(({ group, label }) => {
          const inGroup = items.filter((item) => item.group === group);
          if (inGroup.length === 0) return null;
          return (
            <Section
              key={group}
              title={label}
              aside={<span className="muted">{inGroup.length}</span>}
            >
              <RowList>
                {inGroup.map((item) => (
                  <Row
                    key={item.id}
                    to={item.to}
                    icon={KIND_ICONS[item.kind]}
                    title={item.title}
                    meta={
                      <>
                        {[item.place, item.detail].filter(Boolean).join(' · ')}
                        <span className="row__status radar-action">{item.action}</span>
                      </>
                    }
                    badge={item.visibility}
                  />
                ))}
              </RowList>
            </Section>
          );
        })
      )}
      <p className="prototype-note">
        Пункт радара — не дело: делом он становится только по действию «Взять в работу». В прототипе
        действия не работают.
      </p>
    </Page>
  );
}
