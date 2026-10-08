import { Buildings } from '@phosphor-icons/react';
import { Notice } from '../auth/components.tsx';
import { visibilityOf } from '../notes/abilities.ts';
import { ObjectError } from '../objects/components.tsx';
import { useObjectsList } from '../objects/queries.ts';
import { PropertyStatusBadge } from '../property/PropertyStatusBadge.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { Page } from '../ui/Page.tsx';
import { Row, RowList } from '../ui/Row.tsx';

const BACK = { to: '/more', label: 'Ещё' } as const;

/**
 * «Ещё → Показания» (UTIL-7): выбор недвижимости, по которой вводятся показания. Окон показаний в
 * радаре пока нет (R1a.6), поэтому список — вся недвижимость; название объекта крупно откроется
 * в заголовке следующего экрана.
 */
export function ReadingsPicker() {
  const query = useObjectsList(false);
  const properties = (query.data?.pages.flat() ?? []).filter(
    (object) => object.objectType === 'property',
  );

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
      {properties.length > 0 ? (
        <RowList label="Недвижимость">
          {properties.map((object) => (
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
      ) : null}
    </Page>
  );
}
