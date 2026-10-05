import { Buildings } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { AccessBadge } from '../../access/AccessBadge.tsx';
import { formatRub, formatShortDate } from '../../ui/format.ts';
import { Page, Section } from '../../ui/Page.tsx';
import { Status } from '../../ui/Row.tsx';
import { ScopeEmpty } from '../components.tsx';
import { CHARGES, TODAY } from '../data/index.ts';
import type { PropertyRecord } from '../model.ts';
import { openWindows } from '../radar.ts';
import { usePrototype, useRecords } from '../store.tsx';

function sums(propertyId?: string) {
  const charges = CHARGES.filter(
    (charge) => propertyId === undefined || charge.propertyId === propertyId,
  );
  const charged = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const paid = charges
    .filter((charge) => charge.paid)
    .reduce((sum, charge) => sum + charge.amount, 0);
  return { charged, paid, due: charged - paid };
}

function Money({ charged, paid, due }: { charged: number; paid: number; due: number }) {
  return (
    <dl className="facts">
      <div className="facts__item">
        <dt>Начислено</dt>
        <dd>{formatRub(charged)}</dd>
      </div>
      <div className="facts__item">
        <dt>Оплачено</dt>
        <dd>{formatRub(paid)}</dd>
      </div>
      <div className="facts__item">
        <dt>К оплате</dt>
        <dd className={due > 0 ? 'amount amount--due' : 'amount'}>{formatRub(due)}</dd>
      </div>
    </dl>
  );
}

function ReadingsStatus({ property }: { property: PropertyRecord }) {
  const { state, records } = usePrototype();
  const window = useMemo(
    () =>
      openWindows(records, state.readings, TODAY).find((item) => item.propertyId === property.id),
    [records, state.readings, property.id],
  );
  if (window === undefined) return <Status tone="neutral">Показания: окно закрыто</Status>;
  if (window.transmitted) return <Status tone="ok">Показания переданы</Status>;
  return <Status tone="warning">Показания: передать до {formatShortDate(window.until)}</Status>;
}

/** «Коммуналка за месяц»: по каждому объекту и по всем вместе (UTIL-11). */
export function MonthScreen() {
  const properties = useRecords('property');
  const ids = new Set(properties.map((property) => property.id));
  const total = CHARGES.filter((charge) => ids.has(charge.propertyId)).reduce(
    (acc, charge) => ({
      charged: acc.charged + charge.amount,
      paid: acc.paid + (charge.paid ? charge.amount : 0),
    }),
    { charged: 0, paid: 0 },
  );

  return (
    <Page title="Коммуналка за месяц" eyebrow="Октябрь 2026" back={{ to: '/home', label: 'Дом' }}>
      {properties.length === 0 ? (
        <ScopeEmpty title="Начислений нет" addKind="property" addLabel="Добавить объект">
          Суммы за месяц собираются по объектам недвижимости. Пока в этом режиме объектов нет.
        </ScopeEmpty>
      ) : (
        <>
          <Section title="Все объекты вместе">
            <Money charged={total.charged} paid={total.paid} due={total.charged - total.paid} />
          </Section>
          {properties.map((property) => (
            <Section
              key={property.id}
              title={property.title}
              aside={<AccessBadge visibility={property.visibility} />}
            >
              <Money {...sums(property.id)} />
              <p className="month__status">
                <ReadingsStatus property={property} />
                <Link className="text-button" to={`/home/${property.id}/utilities`}>
                  <Buildings size={20} aria-hidden />
                  Счета и начисления
                </Link>
              </p>
            </Section>
          ))}
        </>
      )}
    </Page>
  );
}
