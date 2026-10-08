import { Buildings } from '@phosphor-icons/react';
import { Notice } from '../auth/components.tsx';
import { useRadar } from '../deadlines/useRadar.ts';
import { openWindowObjectIds } from '../deadlines/utility.ts';
import { visibilityOf } from '../notes/abilities.ts';
import type { ObjectSummary } from '../objects/api.ts';
import { ObjectError } from '../objects/components.tsx';
import { useObjectsList } from '../objects/queries.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page, Section } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';

const BACK = { to: '/more', label: 'Ещё' } as const;

/**
 * «Ещё → Показания» (UTIL-7): выбор недвижимости, по которой вводятся показания. Сначала объекты
 * с открытым окном показаний (R1a.6), затем остальная недвижимость; название объекта крупно
 * откроется в заголовке следующего экрана.
 */
function PropertyList({ label, objects }: { label: string; objects: readonly ObjectSummary[] }) {
  return (
    <RowList label={label}>
      {objects.map((object) => (
        <Row
          key={object.id}
          to={`/home/${object.id}/readings`}
          icon={<Buildings size={22} aria-hidden />}
          title={
            <>
              {object.title}
              {object.typeData.status ? (
                <span className="row__status">
                  <PropertyStatusBadge status={object.typeData.status} />
                </span>
              ) : null}
            </>
          }
          {...(object.typeData.address ? { meta: object.typeData.address } : {})}
          badge={visibilityOf(object)}
        />
      ))}
    </RowList>
  );
}

export function ReadingsPicker() {
  const query = useObjectsList(false);
  const radar = useRadar({ poll: false });
  const properties = (query.data?.pages.flat() ?? []).filter(
    (object) => object.objectType === 'property',
  );
  const open = openWindowObjectIds(radar.rows);
  const withWindow = properties.filter((object) => open.has(object.id));
  const others = properties.filter((object) => !open.has(object.id));

  return (
    <Page title="Показания" back={BACK} eyebrow="Выберите объект">
      {query.isPending ? <Notice>Загружаем объекты…</Notice> : null}
      {query.isError ? (
        <>
          <ObjectError error={query.error} action="load" />
          <button className="text-button" type="button" onClick={() => void query.refetch()}>
            Повторить загрузку объектов
          </button>
        </>
      ) : null}
      {query.data && properties.length === 0 ? (
        <EmptyState icon={<Buildings size={24} aria-hidden />} title="Недвижимости пока нет">
          <p>
            Показания вводятся по квартире, дому или даче. Сначала добавьте объект в разделе «Дом».
          </p>
        </EmptyState>
      ) : null}
      {withWindow.length > 0 ? (
        <Section title="Открыто окно показаний">
          <PropertyList label="Недвижимость с открытым окном" objects={withWindow} />
        </Section>
      ) : null}
      {others.length > 0 ? (
        withWindow.length > 0 ? (
          <Section title="Остальная недвижимость">
            <PropertyList label="Остальная недвижимость" objects={others} />
          </Section>
        ) : (
          <PropertyList label="Недвижимость" objects={others} />
        )
      ) : null}
    </Page>
  );
}
